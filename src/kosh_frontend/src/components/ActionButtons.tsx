import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { 
   
  RefreshCw, 
  GitBranch,
  Send,
  ArrowDown,
  Repeat,
  Copy,
  Check,
  ExternalLink,
  CheckCircle,
  ArrowLeftRight,
  ArrowLeft,
  X
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import SwapComponent from "./SwapComponent";
import TokenBalances from "./TokenBalances";
import TrustlineManager from "./TrustlineManager";
import QRCode from 'qrcode';
import { executeBridgeTransaction, getSupportedChains, getSupportedTokens } from "@/lib/bridgeService";

// Custom animation styles
const animationStyles = `
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes success-glow {
    0%, 100% { box-shadow: 0 0 10px rgba(34, 197, 94, 0.4); }
    50% { box-shadow: 0 0 30px rgba(34, 197, 94, 0.8); }
  }
  
  @keyframes rainbow-border {
    0% { border-color: #22c55e; }
    25% { border-color: #3b82f6; }
    50% { border-color: #a855f7; }
    75% { border-color: #f59e0b; }
    100% { border-color: #22c55e; }
  }
  
  @keyframes celebration-bounce {
    0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-10px); }
    60% { transform: translateY(-5px); }
  }
  
  @keyframes typewriter {
    0% { width: 0; }
    100% { width: 100%; }
  }
  
  .animate-fade-in {
    animation: fade-in 0.5s ease-out;
  }
  
  .animate-success-glow {
    animation: success-glow 2s ease-in-out infinite;
  }
  
  .animate-rainbow-border {
    animation: rainbow-border 3s ease-in-out infinite;
  }
  
  .animate-celebration-bounce {
    animation: celebration-bounce 1s ease-in-out infinite;
  }
  
  .animate-typewriter {
    overflow: hidden;
    white-space: nowrap;
    animation: typewriter 2s steps(40, end);
  }
`;

interface ActionButtonsProps {
  stellarAddress?: any;
  evmAddress?: any;
  onSendTransaction?: (destination: string, amount: string) => Promise<any>;
  onRefreshBalance?: (address?: string) => Promise<string>;
  actor?: any;
  selectedNetwork?: string;
  currentBalance?: string; // Add current balance for Max button
}

const ActionButtons = ({ stellarAddress, evmAddress, onSendTransaction, onRefreshBalance, actor, selectedNetwork }: ActionButtonsProps) => {
  const [showSendModal, setShowSendModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showTokensModal, setShowTokensModal] = useState(false);
  const [showTrustlineModal, setShowTrustlineModal] = useState(false);
  const [showBridgeModal, setShowBridgeModal] = useState(false);
  const [sendForm, setSendForm] = useState({ destination: '', amount: '' });
  // Auto-set destination chain based on Stellar network
  const getDefaultDestChain = (network: string) => {
    if (network === 'stellar-testnet') {
      return { destToken: 'HOLSKEY', destChain: '17000' }; // Holesky Testnet
    } else if (network === 'stellar-mainnet') {
      return { destToken: 'BASE', destChain: '8453' }; // Base Mainnet
    }
    return { destToken: 'HOLSKEY', destChain: '17000' }; // Default to Holesky
  };

  const [bridgeForm, setBridgeForm] = useState(() => {
    const defaultDest = getDefaultDestChain(selectedNetwork || 'stellar-testnet');
    return {
      fromToken: 'XLM', // Default to XLM (native Stellar)
      fromTokenAddress: '', // For custom token addresses
      destToken: defaultDest.destToken,
      amount: '',
      destChain: defaultDest.destChain,
      recipientAddress: ''
    };
  });
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [transactionProgress, setTransactionProgress] = useState(0);
  const [bridgeProgress, setBridgeProgress] = useState(0);
  const [transactionResult, setTransactionResult] = useState<any>(null);
  const [bridgeResult, setBridgeResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");
  const { toast } = useToast();

  // Check if current network is EVM
  const isEvmNetwork = selectedNetwork === 'holesky-testnet' || selectedNetwork === 'base-mainnet';
  const currentAddress = isEvmNetwork ? evmAddress?.evm_address : stellarAddress?.stellar_address;
  const networkName = isEvmNetwork ? (selectedNetwork === 'holesky-testnet' ? 'Holesky' : 'Base') : 'Stellar';
  const currencySymbol = isEvmNetwork ? 'ETH' : 'XLM';

  // Get supported chains and tokens for bridge
  const supportedChains = getSupportedChains();
  const supportedTokens = getSupportedTokens();

  // Update bridge form when network changes
  useEffect(() => {
    const newDest = getDefaultDestChain(selectedNetwork || 'stellar-testnet');
    setBridgeForm(prev => ({
      ...prev,
      destToken: newDest.destToken,
      destChain: newDest.destChain
    }));
  }, [selectedNetwork]);

  // Progress simulation effect for bridge
  useEffect(() => {
    if (bridgeLoading) {
      setBridgeProgress(0);
      setBridgeResult(null);
      const progressInterval = setInterval(() => {
        setBridgeProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 800);

      return () => clearInterval(progressInterval);
    }
  }, [bridgeLoading]);

  // Progress simulation effect for transactions
  useEffect(() => {
    if (transactionLoading) {
      setTransactionProgress(0);
      setTransactionResult(null);
      const progressInterval = setInterval(() => {
        setTransactionProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 15;
        });
      }, 500);

      return () => clearInterval(progressInterval);
    }
  }, [transactionLoading]);



  // Generate QR code when address is available
  useEffect(() => {
    if (currentAddress) {
      generateQRCode(currentAddress);
    }
  }, [currentAddress]);

  const generateQRCode = async (address: string) => {
    try {
      const dataUrl = await QRCode.toDataURL(address, {
        width: 256,
        margin: 2,
        color: {
          dark: '#1a1a1a',
          light: '#ffffff'
        }
      });
      setQrCodeDataUrl(dataUrl);
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    }
  };



  const handleSendTransaction = async () => {
    if (!sendForm.destination || !sendForm.amount) {
      toast({
        title: "Invalid input",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    if (!onSendTransaction) {
      toast({
        title: "Transaction not available",
        description: "Send functionality is not connected",
        variant: "destructive",
      });
      return;
    }

    setTransactionLoading(true);
    setTransactionProgress(0);
    setTransactionResult(null);
    
    try {
      const result = await onSendTransaction(sendForm.destination, sendForm.amount);
      setTransactionProgress(100);
      setTransactionResult(result);
      
      if (result.success) {
        toast({
          title: "Transaction successful!",
          description: result.hash ? `Hash: ${result.hash.substring(0, 16)}...` : result.message,
        });
        
        // Don't close modal immediately to show result
        setTimeout(() => {
          setSendForm({ destination: '', amount: '' });
          setTransactionResult(null);
          setShowSendModal(false);
        }, 5000);
      } else {
        toast({
          title: "Transaction failed",
          description: result.message || "Transaction could not be completed",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Transaction error:', error);
      setTransactionProgress(0);
      setTransactionResult({ success: false, message: error.message });
      toast({
        title: "Transaction failed",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setTransactionLoading(false);
    }
  };

  const handleCopyAddress = async () => {
    if (!currentAddress) return;
    
    try {
      await navigator.clipboard.writeText(currentAddress);
      setCopied(true);
      toast({
        title: "Address copied!",
        description: `${networkName} address copied to clipboard`,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Could not copy address. Please copy manually from the address shown.",
        variant: "destructive",
      });
    }
  };

  const handleBridgeTransaction = async () => {
    if (!bridgeForm.amount || !bridgeForm.recipientAddress || !bridgeForm.destChain) {
      toast({
        title: "Invalid input",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    if (!stellarAddress?.stellar_address) {
      toast({
        title: "Address not available",
        description: "Stellar address is required for bridge operations",
        variant: "destructive",
      });
      return;
    }

    setBridgeLoading(true);
    setBridgeProgress(0);
    setBridgeResult(null);
    
    try {
      console.log('🔒 Starting bridge transaction...');
      
      const lockParams = {
        userAddress: stellarAddress.stellar_address, // Use current user's Stellar address
        fromToken: bridgeForm.fromToken, // XLM (native Stellar)
        destToken: bridgeForm.destToken,
        amount: parseFloat(bridgeForm.amount),
        destChain: bridgeForm.destChain,
        recipientAddress: bridgeForm.recipientAddress
      };

      // Execute bridge transaction using service (with backend integration)
      const result = await executeBridgeTransaction(
        lockParams,
        selectedNetwork || 'stellar-testnet',
        setBridgeProgress,
        actor // Pass actor for backend integration
      );
      
      setBridgeResult(result);
      
      toast({
        title: "Bridge successful!",
        description: `Bridging ${bridgeForm.amount} ${bridgeForm.destToken} to ${result.bridgeDetails?.toChain}`,
      });
      
      // Don't auto-close modal - let user manually close it
      
    } catch (error: any) {
      console.error('Bridge error:', error);
      setBridgeProgress(0);
      setBridgeResult({ 
        success: false, 
        message: error.message || "Bridge transaction failed" 
      });
      toast({
        title: "Bridge failed",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setBridgeLoading(false);
    }
  };


  // Helper function to show coming soon message for EVM networks
  const showComingSoon = (feature: string) => {
    toast({
      title: "Coming Soon!",
      description: `${feature} functionality will be available soon on ${networkName}`,
    });
  };

  const actions = [
    {
      label: "Send",
      icon: Send,
      gradient: "from-blue-500 to-purple-500",
      hoverGradient: "hover:from-blue-500/80 hover:to-purple-500/80",
      onClick: () => setShowSendModal(true),
      disabled: !currentAddress
    },
    {
      label: "Receive", 
      icon: ArrowDown,
      gradient: "from-green-500 to-teal-500",
      hoverGradient: "hover:from-green-500/80 hover:to-teal-500/80",
      onClick: () => setShowReceiveModal(true),
      disabled: !currentAddress
    },
    {
      label: "Trade",
      icon: ArrowLeftRight,
      gradient: "from-purple-500 to-pink-500",
      hoverGradient: "hover:from-purple-500/80 hover:to-pink-500/80",
      onClick: () => {
        if (isEvmNetwork) {
          showComingSoon("Trading");
        } else if (selectedNetwork === 'stellar-testnet') {
          // Show alert to switch to mainnet for trade
          toast({
            title: "Switch to Stellar Mainnet",
            description: "Please switch to Stellar Mainnet to access trading features",
            variant: "default",
          });
        } else {
          setShowSwapModal(true);
        }
      },
      disabled: isEvmNetwork ? false : (!stellarAddress?.stellar_address || !actor)
    },
    {
      label: "Balances",
      icon: Repeat,
      gradient: "from-teal-500 to-cyan-500",
      hoverGradient: "hover:from-teal-500/80 hover:to-cyan-500/80",
      onClick: () => {
        if (isEvmNetwork) {
          showComingSoon("Token balances");
        } else if (selectedNetwork === 'stellar-testnet') {
          // Show alert to switch to mainnet for balances
          toast({
            title: "Switch to Stellar Mainnet",
            description: "Please switch to Stellar Mainnet to access token balance features",
            variant: "default",
          });
        } else {
          setShowTokensModal(true);
        }
      },
      disabled: isEvmNetwork ? false : (!stellarAddress?.stellar_address || !actor)
    },
    {
      label: "Bridge",
      icon: GitBranch,
      gradient: "from-indigo-500 to-purple-500",
      hoverGradient: "hover:from-indigo-500/80 hover:to-purple-500/80",
      onClick: () => {
        // Enable bridge for both Stellar Testnet and Mainnet
        if (selectedNetwork === 'stellar-testnet' || selectedNetwork === 'stellar-mainnet') {
          setShowBridgeModal(true);
        } else {
          showComingSoon("Cross-chain bridging");
        }
      },
      disabled: isEvmNetwork ? false : !stellarAddress?.stellar_address
    }
  ];

  return (
    <>
      {/* Inject custom styles */}
      <style dangerouslySetInnerHTML={{ __html: animationStyles }} />
      
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {actions.map((action) => (
          <div 
            key={action.label}
            className={`relative group ${action.disabled ? 'opacity-60' : 'hover:opacity-90'}`}
            onClick={action.disabled ? undefined : action.onClick}
          >
            <div className={`
              absolute inset-0 bg-gradient-to-br ${action.gradient} rounded-xl 
              opacity-0 group-hover:opacity-100 transition-all duration-300 blur-sm -z-10
              ${action.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
            `}></div>
            
            <Card 
              className={`
                h-full p-2 px-3 sm:px-4 bg-card/70 backdrop-blur-sm border border-border/20 
                transition-all duration-300 group-hover:border-transparent
                ${action.disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:shadow-lg hover:shadow-primary/10'}
                relative overflow-hidden z-0
              `}
            >
              {/* Animated background on hover */}
              <div className={`
                absolute inset-0 bg-gradient-to-br ${action.gradient} 
                opacity-0 group-hover:opacity-5 transition-opacity duration-300 -z-10
              `}></div>
              
              <div className="flex flex-col items-center gap-2 sm:gap-3 text-center">
                <div 
                  className={`
                    w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center 
                    transition-all duration-300 transform group-hover:scale-110
                    ${action.disabled ? 'opacity-70' : 'group-hover:shadow-lg'}
                    ${action.gradient} bg-gradient-to-br
                  `}
                >
                  <action.icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                </div>
                <span className={`
                  text-sm sm:text-base font-medium text-foreground 
                  transition-all duration-300 group-hover:font-semibold
                  ${action.disabled ? 'text-muted-foreground' : 'group-hover:text-primary'}
                `}>
                  {action.label}
                </span>
              </div>
              
              {/* Pulse animation on hover */}
              {!action.disabled && (
                <div className="
                  absolute inset-0 rounded-xl ring-1 ring-inset ring-primary/20 
                  group-hover:ring-primary/40 group-hover:ring-2 transition-all duration-300
                  opacity-0 group-hover:opacity-100 -z-10
                "></div>
              )}
            </Card>
          </div>
        ))}
      </div>

      {/* Send Modal */}
      <Dialog open={showSendModal} onOpenChange={setShowSendModal}>
        <DialogContent className="bg-card/95 backdrop-blur-sm border-border/20">
          <DialogHeader>
            <DialogTitle>Send {currencySymbol}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!transactionResult ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="destination">Destination Address</Label>
                  <Input
                    id="destination"
                    value={sendForm.destination}
                    onChange={(e) => setSendForm({...sendForm, destination: e.target.value})}
                    placeholder={isEvmNetwork ? `Enter ${networkName} address` : "Enter Stellar address"}
                    className="bg-card/50 border-border/20"
                    disabled={transactionLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount ({currencySymbol})</Label>
                  <Input
                    id="amount"
                    type="number"
                    value={sendForm.amount}
                    onChange={(e) => setSendForm({...sendForm, amount: e.target.value})}
                    placeholder="0.00"
                    step="0.0000001"
                    min="0"
                    className="bg-card/50 border-border/20"
                    disabled={transactionLoading}
                  />
                </div>
              </>
            ) : null}

            {/* Progress Bar */}
            {transactionLoading && (
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Processing transaction...</span>
                </div>
                <Progress value={transactionProgress} className="w-full" />
                <p className="text-xs text-center text-muted-foreground">
                  {transactionProgress < 30 ? 'Building transaction...' :
                   transactionProgress < 60 ? 'Signing with threshold cryptography...' :
                   transactionProgress < 90 ? 'Submitting to Stellar network...' :
                   'Finalizing...'}
                </p>
              </div>
            )}

            {/* Transaction Result */}
            {transactionResult && (
              <div className="space-y-4">
                {transactionResult.success ? (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      <span className="font-semibold text-green-500">Transaction Successful!</span>
                    </div>
                    
                    <div className="space-y-2">
                      {transactionResult.hash ? (
                        <>
                          <p className="text-sm text-muted-foreground">Transaction Hash:</p>
                          <div className="bg-card/30 rounded p-2">
                            <p className="font-mono text-xs break-all text-primary">
                              {transactionResult.hash}
                            </p>
                          </div>
                          
                          {transactionResult.explorer_url && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(transactionResult.explorer_url, '_blank')}
                              className="w-full"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              View on Explorer
                            </Button>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-muted-foreground">Transaction Details:</p>
                          <div className="bg-card/30 rounded p-2 max-h-32 overflow-y-auto">
                            <p className="font-mono text-xs break-all text-primary">
                              {transactionResult.raw_response || 'Transaction completed successfully'}
                            </p>
                          </div>
                          <p className="text-xs text-yellow-500">
                            Hash may appear in network explorer shortly
                          </p>
                        </>
                      )}
                    </div>
                    
                    <p className="text-sm text-muted-foreground">
                      Modal will close automatically in a few seconds...
                    </p>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-red-500">❌</span>
                      <span className="font-semibold text-red-500">Transaction Failed</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {transactionResult.message}
                    </p>
                  </div>
                )}
              </div>
            )}

            {!transactionResult && (
              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setShowSendModal(false)}
                  className="flex-1"
                  disabled={transactionLoading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSendTransaction}
                  disabled={transactionLoading || !sendForm.destination || !sendForm.amount}
                  className="flex-1"
                >
                  {transactionLoading ? 'Sending...' : 'Send'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Receive Modal */}
      <Dialog open={showReceiveModal} onOpenChange={setShowReceiveModal}>
        <DialogContent className="bg-card/95 backdrop-blur-sm border-border/20 max-w-sm">
          <DialogHeader>
            <DialogTitle>Receive {currencySymbol}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">Scan QR code or share address to receive {currencySymbol} on {networkName}</p>
            
            {/* QR Code */}
            {qrCodeDataUrl && (
              <div className="flex justify-center">
                <div className="p-4 bg-white rounded-lg border-2 border-border/20">
                  <img 
                    src={qrCodeDataUrl} 
                    alt={`${networkName} Address QR Code`}
                    className="w-48 h-48"
                  />
                </div>
              </div>
            )}
            
            {/* Address */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Your {networkName} Address:</Label>
              <div className="flex items-center gap-3 p-3 bg-card/30 rounded-lg border border-border/10">
                <div className="flex-1">
                  <p className="text-primary font-mono text-xs break-all">
                    {currentAddress || 'Address not available'}
                  </p>
                </div>
                {currentAddress && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyAddress}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
            
            <Button 
              onClick={() => setShowReceiveModal(false)}
              className="w-full"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Trade Modal */}
      <Dialog open={showSwapModal} onOpenChange={setShowSwapModal}>
        <DialogContent className="bg-card/95 backdrop-blur-sm border-border/20 max-w-md w-[calc(100%-2rem)] sm:w-full max-h-[90vh] overflow-y-scroll ">
          <DialogHeader className="relative">
            <DialogTitle className="text-center">Trade</DialogTitle>
            {/* <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-0 h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setShowSwapModal(false)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              <span className="sr-only">Close</span>
            </Button> */}
          </DialogHeader>
          <div className="px-1 py-2">
            <SwapComponent
              actor={actor}
              stellarAddress={stellarAddress}
              selectedNetwork={selectedNetwork}
              onSwapComplete={() => {
                setShowSwapModal(false);
                // Refresh balance after swap
                if (onRefreshBalance) {
                  onRefreshBalance();
                }
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Balances Modal */}
      <Dialog open={showTokensModal} onOpenChange={setShowTokensModal}>
        <DialogContent className="bg-card/95 backdrop-blur-sm border-border/20 max-w-lg">
          <DialogHeader>
            <DialogTitle>Balances</DialogTitle>
          </DialogHeader>
          <TokenBalances
            actor={actor}
            stellarAddress={stellarAddress}
            selectedNetwork={selectedNetwork}
            onAddTrustline={() => {
              setShowTokensModal(false);
              setShowTrustlineModal(true);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Trustline Manager Modal */}
      <Dialog open={showTrustlineModal} onOpenChange={setShowTrustlineModal}>
        <DialogContent className="bg-card/95 backdrop-blur-sm border-border/20 max-w-md w-[calc(100%-2rem)] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-4 top-0 h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setShowTrustlineModal(false);
                setShowTokensModal(true);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span className="sr-only">Back</span>
            </Button>
            <DialogTitle className="text-center">Manage Trustlines</DialogTitle>
          </DialogHeader>
          <div className="px-1 py-2">
            <TrustlineManager
              actor={actor}
              stellarAddress={stellarAddress}
              selectedNetwork={selectedNetwork}
              onTrustlineChange={() => {
                setShowTrustlineModal(false);
                // Refresh token balances if they're open
                if (onRefreshBalance) {
                  onRefreshBalance();
                }
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Bridge Modal */}
      <Dialog open={showBridgeModal} onOpenChange={(open) => {
        if (!open) {
          // Clear all bridge state when closing modal
          const currentDest = getDefaultDestChain(selectedNetwork || 'stellar-testnet');
          setBridgeForm({ 
            fromToken: 'XLM',
            fromTokenAddress: '',
            destToken: currentDest.destToken,
            amount: '',
            destChain: currentDest.destChain,
            recipientAddress: ''
          });
          setBridgeResult(null);
          setBridgeProgress(0);
          setBridgeLoading(false);
        }
        setShowBridgeModal(open);
      }}>
        <DialogContent className="bg-card/95 backdrop-blur-sm border-border/20 max-w-lg w-[calc(100%-2rem)] sm:w-full relative">
          <DialogHeader className="pb-4 pr-12">
            <DialogTitle className="flex items-center justify-center gap-2 pr-8">
              <GitBranch className="w-5 h-5 text-indigo-500" />
              Bridge Tokens
            </DialogTitle>
          </DialogHeader>
          <div className="px-1 py-2 space-y-4 max-h-[60vh] overflow-y-auto">
            {!bridgeResult ? (
              <>
                {/* <div className="space-y-2">
                  <Label htmlFor="fromToken">From Token Address</Label>
                  <Input
                    id="fromToken"
                    value={bridgeForm.fromTokenAddress}
                    onChange={(e) => setBridgeForm({...bridgeForm, fromTokenAddress: e.target.value})}
                    placeholder="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
                    className="bg-card/50 border-border/20 font-mono text-xs"
                    disabled={bridgeLoading}
                  />
                  <p className="text-xs text-muted-foreground">Stellar token contract address</p>
                </div> */}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="destToken">Destination Token</Label>
                    <div className="w-full px-3 py-2 bg-card/50 border border-border/20 rounded-md text-sm text-muted-foreground">
                      {bridgeForm.destToken} - {bridgeForm.destToken === 'HOLSKEY' ? 'Holskey Token' : 'Base Token'}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Automatically set based on network
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="destChain">Destination Chain</Label>
                    <div className="w-full px-3 py-2 bg-card/50 border border-border/20 rounded-md text-sm text-muted-foreground">
                      {bridgeForm.destChain === '17000' ? '🔷 Holesky Testnet (17000)' : '🔵 Base Mainnet (8453)'}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Automatically set based on network
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bridgeAmount">Amount</Label>
                  <Input
                    id="bridgeAmount"
                    type="number"
                    value={bridgeForm.amount}
                    onChange={(e) => setBridgeForm({...bridgeForm, amount: e.target.value})}
                    placeholder="0.00"
                    step="0.0000001"
                    min="0"
                    className="bg-card/50 border-border/20"
                    disabled={bridgeLoading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="recipientAddress">Recipient Address</Label>
                  <Input
                    id="recipientAddress"
                    value={bridgeForm.recipientAddress}
                    onChange={(e) => setBridgeForm({...bridgeForm, recipientAddress: e.target.value})}
                    placeholder="0x8Da1867ab5eE5385dc72f5901bC9Bd16F580d157"
                    className="bg-card/50 border-border/20 font-mono text-xs"
                    disabled={bridgeLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    {bridgeForm.destChain === '17000' ? 'Holesky Testnet wallet address' : 
                     bridgeForm.destChain === '8453' ? 'Base Mainnet wallet address' : 
                     'Destination chain wallet address'}
                  </p>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500 mt-2 shrink-0"></div>
                    <div className="text-sm text-amber-700 dark:text-amber-300">
                      <p className="font-semibold mb-1">Bridge Notice</p>
                      <p>For demo purposes, we are using 1 XLM = 0.000081 ETH price conversion. This will lock your tokens on Stellar and mint equivalent tokens on the destination chain.</p>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {/* Bridge Progress Bar */}
            {bridgeLoading && (
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Processing bridge transaction...</span>
                </div>
                <Progress value={bridgeProgress} className="w-full" />
                <p className="text-xs text-center text-muted-foreground">
                  {bridgeProgress < 30 ? 'Preparing bridge transaction...' :
                   bridgeProgress < 40 ? '🔒 Calling Stellar lock transaction...' :
                   bridgeProgress < 50 ? '✅ Stellar transaction locked successfully!' :
                   bridgeProgress < 70 ? '⚡ Indexing transaction on ICP...' :
                   bridgeProgress < 90 ? '🔐 Building release with threshold cryptography...' :
                   bridgeProgress < 95 ? '🚀 Release transaction completed!' :
                   '✅ Bridge completed successfully!'}
                </p>
              </div>
            )}

            {/* Bridge Result */}
            {bridgeResult && (
              <div className="space-y-4">
                {bridgeResult.success ? (
                  <div className="bg-card/30 border border-border/40 rounded-lg p-4 space-y-4">
                    {/* Success Header with Close Button */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-6 h-6 text-green-500" />
                        <h3 className="text-lg font-semibold">Bridge Completed Successfully</h3>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setBridgeResult(null);
                          const currentDest = getDefaultDestChain(selectedNetwork || 'stellar-testnet');
                          setBridgeForm({ 
                            fromToken: 'XLM',
                            fromTokenAddress: '',
                            destToken: currentDest.destToken,
                            amount: '',
                            destChain: currentDest.destChain,
                            recipientAddress: ''
                          });
                          setShowBridgeModal(false);
                        }}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </Button>
                    </div>
                    
                    {/* Transaction Details */}
                    <div className="space-y-3">
                      {/* Lock Transaction */}
                      {bridgeResult.contractDetails?.lockHash && (
                        <div className="bg-card/50 rounded-lg p-3 border border-border/20">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-medium">🔒 Lock Transaction (Stellar)</h4>
                          </div>
                          <div className="space-y-2">
                            <div className="font-mono text-xs bg-card/30 rounded p-2 break-all">
                              {bridgeResult.contractDetails.lockHash}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(`https://stellar.expert/explorer/testnet/tx/${bridgeResult.contractDetails.lockHash}`, '_blank')}
                              className="w-full"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              View on Explorer
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      {/* Release Transaction */}
                      {bridgeResult.hash && (
                        <div className="bg-card/50 rounded-lg p-3 border border-border/20">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-medium">🚀 Release Transaction ({bridgeResult.bridgeDetails?.toChain || 'Destination Chain'})</h4>
                          </div>
                          <div className="space-y-2">
                            <div className="font-mono text-xs bg-card/30 rounded p-2 break-all">
                              {bridgeResult.hash}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(bridgeResult.explorer_url, '_blank')}
                              className="w-full"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              View on {bridgeResult.bridgeDetails?.toChain || 'Destination'} Explorer
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-red-500">❌</span>
                      <span className="font-semibold text-red-500">Bridge Failed</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {bridgeResult.message}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons - Only show when no bridge result */}
            {!bridgeResult && (
              <div className="sticky bottom-0 bg-card/95 backdrop-blur-sm border-t border-border/20 pt-4 mt-6">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Clear all bridge state when canceling
                      const currentDest = getDefaultDestChain(selectedNetwork || 'stellar-testnet');
                      setBridgeForm({ 
                        fromToken: 'XLM',
                        fromTokenAddress: '',
                        destToken: currentDest.destToken,
                        amount: '',
                        destChain: currentDest.destChain,
                        recipientAddress: ''
                      });
                      setBridgeResult(null);
                      setBridgeProgress(0);
                      setBridgeLoading(false);
                      setShowBridgeModal(false);
                    }}
                    className="flex-1 text-sm"
                    disabled={bridgeLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleBridgeTransaction}
                    disabled={bridgeLoading || !bridgeForm.amount || !bridgeForm.recipientAddress}
                    className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-sm"
                  >
                    {bridgeLoading ? 'Bridging...' : 'Bridge Tokens'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ActionButtons