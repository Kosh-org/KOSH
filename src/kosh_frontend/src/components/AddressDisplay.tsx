import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Copy, Check, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { copyToClipboard } from "@/lib/clipboard";

interface AddressDisplayProps {
  stellarAddress?: any;
  evmAddress?: any;
  walletLoading?: boolean;
  onRetryAddress?: () => Promise<any>;
  onRetryEvmAddress?: () => Promise<any>;
  selectedNetwork?: string;
}

const AddressDisplay = ({ stellarAddress, evmAddress, walletLoading, onRetryAddress, onRetryEvmAddress, selectedNetwork }: AddressDisplayProps) => {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  
  // Determine which address to show based on network
  const isEvmNetwork = selectedNetwork === 'holesky-testnet' || selectedNetwork === 'base-mainnet';
  const currentAddressData = isEvmNetwork ? evmAddress : stellarAddress;
  const address = isEvmNetwork ? evmAddress?.evm_address : stellarAddress?.stellar_address;
  const networkName = isEvmNetwork ? (selectedNetwork === 'holesky-testnet' ? 'Holesky' : 'Base') : 'Stellar';
  const addressType = isEvmNetwork ? 'EVM Address' : 'Stellar Address';
  
  const handleCopy = async () => {
    if (!address) return;
    
    try {
      const success = await copyToClipboard(address);
      
      if (success) {
        setCopied(true);
        toast({
          title: "Address copied!",
          description: `${networkName} address copied to clipboard`,
        });
        setTimeout(() => setCopied(false), 2000);
      } else {
        throw new Error('Copy operation failed');
      }
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Could not copy address. Please copy manually from the address shown above.",
        variant: "destructive",
      });
    }
  };

  const handleRetry = async () => {
    const retryFunction = isEvmNetwork ? onRetryEvmAddress : onRetryAddress;
    if (retryFunction) {
      try {
        await retryFunction();
        toast({
          title: "Address generation started",
          description: `Please wait while we generate your ${networkName} address`,
        });
      } catch (error) {
        toast({
          title: "Retry failed",
          description: "Could not retry address generation",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <Card className="p-6 bg-gradient-card backdrop-blur-md border-border/20 shadow-card">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground font-medium">Your {addressType}:</p>
          {isEvmNetwork && (
            <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full">
              {networkName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 p-3 bg-card/30 rounded-lg border border-border/10">
          <div className="flex-1">
            {walletLoading ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                <p className="text-muted-foreground text-sm">Generating your {networkName} address...</p>
              </div>
            ) : currentAddressData?.error ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-destructive text-sm font-semibold">{currentAddressData.error}</p>
                  {currentAddressData.details && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                      <p className="text-destructive/80 text-xs whitespace-pre-line">{currentAddressData.details}</p>
                    </div>
                  )}
                  {currentAddressData.suggestion && (
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3">
                      <p className="text-blue-400 text-xs">💡 {currentAddressData.suggestion}</p>
                    </div>
                  )}
                </div>
                {!currentAddressData.details && (
                  <Button 
                    onClick={handleRetry}
                    size="sm"
                    variant="outline"
                    className="text-xs"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Retry
                  </Button>
                )}
              </div>
            ) : address ? (
              <p className="text-primary font-mono text-sm break-all">{address}</p>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">Address not available</p>
                <Button 
                  onClick={handleRetry}
                  size="sm"
                  variant="outline"
                  className="text-xs"
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Generate Address
                </Button>
              </div>
            )}
          </div>
          {address && !walletLoading && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              className="shrink-0 hover:bg-primary/10 transition-smooth"
            >
              {copied ? (
                <Check className="w-4 h-4 text-success" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

export default AddressDisplay;