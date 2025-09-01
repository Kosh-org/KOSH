// Bridge service for cross-chain token locking and bridging
// Based on Stellar Soroban smart contracts

import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  nativeToScVal,
  TransactionBuilder,
  Transaction,
  rpc
} from '@stellar/stellar-sdk';

// import { Actor } from '../types/backend';
type Actor = any; // Temporary type definition

interface BridgeParams {
  userAddress: string;
  fromToken: string;
  destToken: string;
  amount: number;
  destChain: string;
  recipientAddress: string;
}

interface BridgeConfig {
  contractId: string;
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
}

interface AccountData {
  sequence: string;
  balances: any[];
}

interface BridgeResult {
  success: boolean;
  hash: string;
  message: string;
  explorer_url: string;
  contractDetails?: {
    contractId: string;
    sequenceNumber: string;
    network: string;
    userAddress: string;
    transactionXDR?: string;
    lockHash?: string;
  };
  bridgeDetails: {
    fromChain: string;
    toChain: string;
    amount: string;
    token: string;
    recipient: string;
    contractExecution?: boolean;
  };
}

interface TransactionBuildResult {
  transaction: Transaction;
  transactionXDR: string;
  contractCall: {
    contractId: string;
    method: string;
    parameters: {
      user: string;
      fromToken: string;
      destToken: string;
      amount: number;
      destChain: string;
      recipientAddress: string;
    };
  };
  networkConfig: {
    network: string;
    networkPassphrase: string;
    rpcUrl: string;
  };
  bridgeCompleted?: boolean;
  holeskyTxHash?: string;
  lockTxHash?: string;
}

export class StellarBridgeService {
  private server: rpc.Server;
  private config: {
    rpcUrl: string;
    defaultBridge: string;
    defaultUser?: string;
  };

  constructor(config: any = {}) {
    this.config = {
      rpcUrl: config.rpcUrl || "https://soroban-testnet.stellar.org",
      defaultBridge: config.defaultBridge || "CDTA5IYGUGRI4PAGXJL7TPBEIC3EZY6V23ILF5EDVXFVLCGGMVOK4CRL",
      defaultUser: config.defaultUser, // Remove default, will be passed when needed
      ...config
    };
    
    this.server = new rpc.Server(this.config.rpcUrl, { 
      allowHttp: this.config.rpcUrl.startsWith("http://") 
    });
  }

  validateAddress(address: string, name: string): boolean {
    try {
      new Address(address);
      return true;
    } catch (e: any) {
      throw new Error(`Invalid ${name}: ${address} - ${e.message}`);
    }
  }

  hexToBytes(hex: string): Uint8Array {
    let s = hex.toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]*$/.test(s) || s.length % 2) {
      throw new Error("Invalid hex for dest-chain");
    }
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < s.length; i += 2) {
      out[i / 2] = parseInt(s.slice(i, i + 2), 16);
    }
    return out;
  }

  toBytes(val: string): Uint8Array {
    if (typeof val !== "string") {
      throw new Error("dest-chain must be a string");
    }
    if (val.startsWith("0x") || /^[0-9a-fA-F]+$/.test(val.replace(/^0x/, ""))) {
      try { 
        return this.hexToBytes(val); 
      } catch { 
        // fallthrough to utf-8
      }
    }
    return new TextEncoder().encode(val);
  }

  async createLockTransactionXDR(params: any): Promise<any> {
    const {
      bridgeId = this.config.defaultBridge,
      userAddress, // Don't use default, require this to be passed
      destToken = "native",
      inAmount = "17000",
      recipient = "0x742d35Cc6634C0532925a3b8D29435B7b6c8ceB3",
      destChain = "10",
      fromToken = null
    } = params;

    // Ensure userAddress is provided
    if (!userAddress) {
      throw new Error("userAddress is required");
    }
console.log("this is  params ", params)
console.log("this is  userAddress ", userAddress)
    this.validateAddress(userAddress, "userAddress");
    this.validateAddress(bridgeId, "bridgeId");

    const { passphrase: networkPassphrase } = await this.server.getNetwork();
    const account = await this.server.getAccount(userAddress);

    const fromTokenAddr = fromToken || Asset.native().contractId(networkPassphrase);

    const contract = new Contract(bridgeId);

    const from = new Address(userAddress);
    const fromTokenAddress = new Address(fromTokenAddr);
    const destTokenStr = destToken;
    const inAmountI128 = nativeToScVal(inAmount, { type: "i128" });
    const destChainBytes = this.toBytes(destChain);
    const recipientStr = recipient;

    const op = contract.call(
      "lock",
      nativeToScVal(from),
      nativeToScVal(fromTokenAddress),
      nativeToScVal(destTokenStr),
      inAmountI128,
      nativeToScVal(destChainBytes),
      nativeToScVal(recipientStr),
    );

    let tx = new TransactionBuilder(account, {
      fee: String(BASE_FEE),
      networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(300)
      .build();

    tx = await this.server.prepareTransaction(tx);

    return {
      xdr: tx.toXDR(),
      metadata: {
        rpc: this.config.rpcUrl,
        networkPassphrase,
        source: userAddress,
        bridgeContract: bridgeId,
        fromToken: fromTokenAddr,
        destToken,
        inAmount,
        destChainBytesLen: destChainBytes.length,
        recipient,
      }
    };
  }
}

// Get bridge configuration based on network
export const getBridgeConfig = (network: string): BridgeConfig => {
  const isTestnet = network !== 'stellar-mainnet';
  
  return {
    contractId: 'CDTA5IYGUGRI4PAGXJL7TPBEIC3EZY6V23ILF5EDVXFVLCGGMVOK4CRL',
    network: isTestnet ? 'testnet' : 'mainnet',
    rpcUrl: isTestnet ? 'https://soroban-testnet.stellar.org' : 'https://soroban-mainnet.stellar.org',
    networkPassphrase: isTestnet ? 'Test SDF Network ; September 2015' : 'Public Global Stellar Network ; September 2015'
  };
};

// Get destination chain name from chain ID
export const getChainName = (chainId: string): string => {
  const chainNames: Record<string, string> = {
    '17000': 'Holsky Testnet',
    '8453': 'Base Mainnet'
  };
  
  return chainNames[chainId] || `Chain ${chainId}`;
};

// Get explorer URL for the destination chain
export const getChainExplorerUrl = (chainId: string, txHash: string): string => {
  const explorerUrls: Record<string, string> = {
    '17000': `https://holesky.etherscan.io/tx/${txHash}`,
    '8453': `https://basescan.org/tx/${txHash}`
  };
  
  return explorerUrls[chainId] || `#${txHash}`;
};

// Validate bridge parameters
export const validateBridgeParams = (params: BridgeParams): string | null => {
  if (!params.userAddress) {
    return "User address is required";
  }
  
  if (!params.fromToken || params.fromToken !== 'XLM') {
    return "Only XLM token is supported";
  }
  
  if (!params.destToken || (params.destToken !== 'HOLSKEY' && params.destToken !== 'BASE')) {
    return "Only HOLSKEY and BASE tokens are supported";
  }
  
  if (!params.amount || params.amount <= 0) {
    return "Amount must be greater than 0";
  }
  
  if (!params.destChain || (params.destChain !== '17000' && params.destChain !== '8453')) {
    return "Only Holsky Testnet (17000) and Base Mainnet (8453) are supported";
  }
  
  if (!params.recipientAddress) {
    return "Recipient address is required";
  }
  
  // Validate Ethereum-like address format for EVM chains
  if (params.destChain === '17000' || params.destChain === '8453') {
    if (!params.recipientAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      const chainName = params.destChain === '17000' ? 'Holsky Testnet' : 'Base Mainnet';
      return `Invalid recipient address format for ${chainName}`;
    }
  }
  
  return null;
};

// Get account data from Stellar Horizon API
export const getAccountData = async (address: string, network: string): Promise<AccountData> => {
  const horizonUrl = network === 'mainnet' 
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
  
  console.log(`🔍 Fetching account data for ${address} from ${horizonUrl}`);
  
  try {
    const response = await fetch(`${horizonUrl}/accounts/${address}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Account not found. Please fund your account first.');
      }
      throw new Error(`Failed to fetch account data: ${response.status}`);
    }
    
    const accountData = await response.json();
    console.log('✅ Account data fetched:', { 
      sequence: accountData.sequence,
      balance: accountData.balances?.[0]?.balance 
    });
    
    return {
      sequence: accountData.sequence,
      balances: accountData.balances
    };
  } catch (error) {
    console.error('❌ Failed to fetch account data:', error);
    throw error;
  }
};

// Build actual Stellar transaction using Stellar SDK
export const buildStellarTransaction = async (
  params: BridgeParams, 
  config: BridgeConfig, 
  accountData: AccountData,
  actor?: Actor,
  onProgress?: (progress: number) => void
): Promise<TransactionBuildResult> => {
  console.log('🔒 Building Stellar transaction with SDK...');
  console.log('📊 Parameters:', params);
  console.log('📋 Config:', config);
  console.log('💰 Account data:', accountData);
  
  try {
    // Use the new StellarBridgeService class for proper transaction building
    const bridgeService = new StellarBridgeService({
      rpcUrl: config.rpcUrl,
      defaultBridge: config.contractId
    });
    
    // Convert amount to stroops (1 XLM = 10,000,000 stroops)
    const amountStroops = Math.floor(params.amount * 10_000_000);
    console.log('💰 Amount in stroops:', amountStroops);
    
    // Build transaction using the proper service
    const result = await bridgeService.createLockTransactionXDR({
      bridgeId: config.contractId,
      userAddress: params.userAddress,
      destToken: params.destToken,
      inAmount: amountStroops.toString(),
      recipient: params.recipientAddress,
      destChain: params.destChain,
      fromToken: null // Use native XLM
    });

    console.log("params_userAddress",params.userAddress)
    
    console.log('✅ Transaction built successfully with new service');
    console.log('📝 Transaction XDR:', result.xdr);

    // Create Transaction object from XDR for compatibility
    const transaction = TransactionBuilder.fromXDR(result.xdr, result.metadata.networkPassphrase) as Transaction;

    if (actor) {
      // Update progress - calling stellar lock transaction
      onProgress?.(30);
      console.log('🔒 Calling Stellar lock transaction...');
      
      const lock_txn=await actor.stellar_user_lock_txn(result.xdr, config.network);
      console.log("Lock transaction response:", lock_txn);

      // Extract transaction hash from the response
      if (lock_txn && 'Ok' in lock_txn) {
        const responseData = JSON.parse(lock_txn.Ok);
        const txHash = responseData.hash;
        
        if (txHash) {
          // Update progress - Stellar transaction locked successfully
          onProgress?.(40);
          console.log('✅ Stellar transaction locked successfully!');
          console.log("🔒 Lock Transaction Hash:", txHash);
          console.log("📄 Lock Transaction Details:", responseData);
          
          // Fetch transaction details from Horizon to get ledger number
          try {
            const horizonUrl = `https://horizon-testnet.stellar.org/transactions/${txHash}`;
            const txResponse = await fetch(horizonUrl);
            const txData = await txResponse.json();
            
            const ledgerNumber = txData.ledger;
            console.log("📊 Ledger number for indexing:", ledgerNumber);
            
            // Update progress when indexer starts working
            onProgress?.(50);
            console.log('⚡ Indexing transaction on ICP...');
            
            // Wait 8 seconds for Stellar transaction to be fully processed and included in ledger
            console.log('⏳ Waiting 8 seconds for Stellar network processing...');
            await new Promise(resolve => setTimeout(resolve, 8000));
            
            // Call fetch_stellar_events with ledger number and destination chain to start indexing and release
            const release_tnx = await actor.fetch_stellar_events(ledgerNumber, params.destChain);
            console.log("🔍 Stellar events response:", release_tnx);
            
            // Extract Holesky transaction hash from the response
            if (release_tnx && 'Ok' in release_tnx) {
              const holeskyTxHash = release_tnx.Ok.trim();
              
              if (holeskyTxHash && holeskyTxHash.startsWith('0x')) {
                // Update progress when building release transaction
                onProgress?.(70);
                console.log('🔐 Building release with threshold cryptography...');
                
                // Update progress when transaction hash is received (release completed)
                onProgress?.(90);
                console.log('🚀 Release transaction completed successfully!');
                console.log("✅ Release Transaction Hash:", holeskyTxHash);
                
                const explorerUrl = getChainExplorerUrl(params.destChain, holeskyTxHash);
                console.log(`🌐 ${getChainName(params.destChain)} Explorer: ${explorerUrl}`);
                
                // Store the transaction hash for later use in the bridge result
                (window as any).holeskyTxHash = holeskyTxHash;
                (window as any).holeskyExplorerUrl = explorerUrl;
                
                // Since we have the transaction hash, we can complete the bridge here
                onProgress?.(100);
                return {
                  transaction,
                  transactionXDR: result.xdr,
                  contractCall: {
                    contractId: config.contractId,
                    method: 'lock',
                    parameters: {
                      user: params.userAddress,
                      fromToken: result.metadata.fromToken,
                      destToken: params.destToken,
                      amount: amountStroops,
                      destChain: params.destChain,
                      recipientAddress: params.recipientAddress
                    }
                  },
                  networkConfig: {
                    network: config.network,
                    networkPassphrase: result.metadata.networkPassphrase,
                    rpcUrl: config.rpcUrl
                  },
                  bridgeCompleted: true, // Flag to indicate bridge is complete
                  holeskyTxHash: holeskyTxHash,
                  lockTxHash: txHash // Include the Stellar lock transaction hash
                };
              }
            }
          } catch (error) {
            console.error("Error fetching transaction details:", error);
          }
        }
      }
    }
    
    return {
      transaction,
      transactionXDR: result.xdr,
      contractCall: {
        contractId: config.contractId,
        method: 'lock',
        parameters: {
          user: params.userAddress,
          fromToken: result.metadata.fromToken,
          destToken: params.destToken,
          amount: amountStroops,
          destChain: params.destChain,
          recipientAddress: params.recipientAddress
        }
      },
      networkConfig: {
        network: config.network,
        networkPassphrase: result.metadata.networkPassphrase,
        rpcUrl: config.rpcUrl
      }
    };
  } catch (error) {
    console.error('❌ Failed to build Stellar transaction:', error);
    throw new Error(`Failed to build transaction: ${(error as Error).message}`);
  }
};

// Build lock transaction for Soroban contract (legacy function)
export const buildLockTransaction = async (params: BridgeParams, config: BridgeConfig) => {
  console.log('🔒 Building lock transaction with params:', params);
  console.log('📋 Bridge config:', config);
  
  // Legacy implementation for backwards compatibility
  const contractCall = {
    contractId: config.contractId,
    method: 'lock',
    parameters: {
      user: params.userAddress,
      fromToken: params.fromToken, // XLM (native Stellar)
      destToken: params.destToken,
      amount: params.amount,
      destChain: params.destChain,
      recipientAddress: params.recipientAddress
    }
  };
  
  return {
    contractCall,
    params: {
      network: config.network,
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase
    }
  };
};

// Execute bridge transaction (with frontend-built transactions)
export const executeBridgeTransaction = async (
  params: BridgeParams, 
  network: string, 
  onProgress?: (progress: number) => void,
  actor?: Actor
): Promise<BridgeResult> => {
  // Validate parameters
  const validationError = validateBridgeParams(params);
  if (validationError) {
    throw new Error(validationError);
  }
  
  const config = getBridgeConfig(network);
  onProgress?.(10);
  
  console.log('🔒 Starting bridge execution...');
  console.log('📊 Bridge parameters:', params);
  console.log('⚙️ Network config:', config);
  
  // Build the transaction
  onProgress?.(25);
  const { contractCall } = await buildLockTransaction(params, config);
  console.log('📝 Contract call built:', contractCall);
  
  // Build the transaction on frontend using Stellar SDK
  try {
    onProgress?.(30);
    console.log('🔍 Fetching account data from Stellar...');
    
    // Get account data (sequence number, etc.)
    const accountData = await getAccountData(params.userAddress, config.network);
    
    onProgress?.(40);
    console.log('🔨 Building Soroban contract transaction...');
    
    // Build the actual Stellar transaction using Stellar SDK
    const buildResult = await buildStellarTransaction(params, config, accountData, actor, onProgress);
    const { transactionXDR, contractCall: stellarContractCall, networkConfig, bridgeCompleted, holeskyTxHash, lockTxHash } = buildResult;
    
    console.log('✅ Transaction built on frontend:', {
      contractId: stellarContractCall.contractId,
      method: stellarContractCall.method,
      xdrLength: transactionXDR.length,
      bridgeCompleted: bridgeCompleted
    });
    
    // Update progress when XDR is created - Locking Stellar transaction completed
    onProgress?.(25);
    console.log('🔒 Locking Stellar transaction completed successfully!');
    
    // If bridge is already completed (we have Holesky tx hash), return success
    if (bridgeCompleted && holeskyTxHash) {
      console.log('✅ Bridge already completed with Holesky transaction:', holeskyTxHash);
      
      const result: BridgeResult = {
        success: true,
        hash: holeskyTxHash,
        message: "Bridge transaction completed successfully",
        explorer_url: getChainExplorerUrl(params.destChain, holeskyTxHash),
        contractDetails: {
          contractId: stellarContractCall.contractId,
          sequenceNumber: accountData.sequence,
          network: networkConfig.network,
          userAddress: params.userAddress,
          transactionXDR: transactionXDR,
          lockHash: lockTxHash // Include the Stellar lock transaction hash
        },
        bridgeDetails: {
          fromChain: 'Stellar',
          toChain: getChainName(params.destChain),
          amount: params.amount.toString(),
          token: params.destToken,
          recipient: params.recipientAddress,
          contractExecution: true
        }
      };
      
      console.log('✅ Bridge completed:', result);
      return result;
    }
    
    // If backend actor is available, use it for signing and submission
    if (actor) {
      try {
        onProgress?.(60);
        console.log('📞 Sending transaction to backend for signing...');
        
        // Call a simpler backend function that just signs and submits the XDR
        const signResult = await actor.sign_transaction_stellar(
          params.userAddress,
          transactionXDR,
          network
        );
        
        onProgress?.(80);
        
        if ('Ok' in signResult) {
          console.log('✅ Transaction signed successfully');
          
          onProgress?.(90);
          console.log('📤 Submitting signed transaction to Stellar network...');
          
          // Submit the signed transaction
          const submitResult = await actor.submit_transaction(signResult.Ok, network);
          
          if ('Ok' in submitResult) {
            const submissionResponse = JSON.parse(submitResult.Ok);
            console.log('✅ Transaction submitted successfully:', submissionResponse);
            
            onProgress?.(100);
            
            // Use Holesky transaction hash if available, otherwise fall back to Stellar hash
            const holeskyTxHash = (window as any).holeskyTxHash;
            const holeskyExplorerUrl = (window as any).holeskyExplorerUrl;
            
            const result: BridgeResult = {
              success: true,
              hash: holeskyTxHash || submissionResponse.hash || `stellar_tx_${Date.now()}`,
              message: holeskyTxHash ? "Bridge transaction completed successfully" : "Soroban lock contract executed successfully",
              explorer_url: holeskyExplorerUrl || `https://stellar.expert/explorer/${config.network}/tx/${submissionResponse.hash || 'demo'}`,
              contractDetails: {
                contractId: stellarContractCall.contractId,
                sequenceNumber: accountData.sequence,
                network: networkConfig.network,
                userAddress: params.userAddress,
                transactionXDR: transactionXDR
              },
              bridgeDetails: {
                fromChain: 'Stellar',
                toChain: getChainName(params.destChain),
                amount: params.amount.toString(),
                token: params.destToken,
                recipient: params.recipientAddress,
                contractExecution: true
              }
            };
            
            console.log('✅ Frontend-built Soroban bridge completed:', result);
            return result;
          } else {
            throw new Error(`Transaction submission failed: ${submitResult.Err}`);
          }
        } else {
          throw new Error(`Transaction signing failed: ${signResult.Err}`);
        }
      } catch (error) {
        console.error('❌ Backend signing/submission error:', error);
        throw new Error(`Transaction signing/submission failed: ${(error as Error).message || error}`);
      }
    } else {
      // No backend actor available - return transaction for manual handling
      console.warn('⚠️ No backend actor available for signing');
      throw new Error('Backend not available for transaction signing');
    }
  } catch (error) {
    console.error('❌ Frontend transaction building error:', error);
    throw new Error(`Transaction building failed: ${(error as Error).message || error}`);
  }
};

// Estimate bridge fees (demo implementation)
export const estimateBridgeFees = async (params: BridgeParams, network: string) => {
  getBridgeConfig(network); // Get config but don't use it in this demo
  
  // Mock fee calculation based on amount and destination chain
  const baseNetworkFee = 0.00001; // Base Stellar network fee
  const bridgeFeePercent = 0.001; // 0.1% bridge fee
  
  const networkFee = baseNetworkFee;
  const bridgeFee = params.amount * bridgeFeePercent;
  const totalFee = networkFee + bridgeFee;
  
  return {
    networkFee: networkFee.toFixed(7),
    bridgeFee: bridgeFee.toFixed(7),
    totalFee: totalFee.toFixed(7)
  };
};

// Get supported destination chains
export const getSupportedChains = () => [
  { id: '17000', name: 'Holsky Testnet', symbol: 'ETH', icon: '🔷' },
  { id: '8453', name: 'Base Mainnet', symbol: 'ETH', icon: '🔵' }
];

// Get supported destination tokens
export const getSupportedTokens = () => [
  { symbol: 'HOLSKEY', name: 'Holskey Token', chains: ['17000'] },
  { symbol: 'BASE', name: 'Base Token', chains: ['8453'] }
];

// Get supported source tokens (from Stellar)
export const getSupportedSourceTokens = () => [
  { symbol: 'XLM', name: 'Stellar Lumens', type: 'native' }
];

export default {
  StellarBridgeService,
  getBridgeConfig,
  getChainName,
  getChainExplorerUrl,
  validateBridgeParams,
  getAccountData,
  buildStellarTransaction,
  buildLockTransaction,
  executeBridgeTransaction,
  estimateBridgeFees,
  getSupportedChains,
  getSupportedTokens,
  getSupportedSourceTokens
};