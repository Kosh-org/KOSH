import { useState, useEffect } from 'react';
import { AuthClient } from '@dfinity/auth-client';
import { createActor } from 'declarations/kosh_backend';
import { getAccountBalance as stellarGetAccountBalance } from './lib/stellarApi.js';

// Define canister IDs - use environment variables from Vite
const getCanisterIds = () => {
  return {
    INTERNET_IDENTITY: import.meta.env.VITE_INTERNET_IDENTITY_CANISTER_ID || 'rdmx6-jaaaa-aaaaa-aaadq-cai',
    BACKEND: import.meta.env.VITE_KOSH_BACKEND_CANISTER_ID || 'nlfjr-7qaaa-aaaaj-qnsiq-cai',
    FRONTEND: import.meta.env.VITE_KOSH_FRONTEND_CANISTER_ID || 'ncgcn-jyaaa-aaaaj-qnsja-cai'
  };
};

const CANISTER_IDS = getCanisterIds();

// Debug logging for canister IDs
console.log('🔧 Environment Variables:', {
  VITE_INTERNET_IDENTITY_CANISTER_ID: import.meta.env.VITE_INTERNET_IDENTITY_CANISTER_ID,
  VITE_KOSH_BACKEND_CANISTER_ID: import.meta.env.VITE_KOSH_BACKEND_CANISTER_ID,
  VITE_KOSH_FRONTEND_CANISTER_ID: import.meta.env.VITE_KOSH_FRONTEND_CANISTER_ID,
  VITE_II_URL: import.meta.env.VITE_II_URL,
  VITE_DFX_NETWORK: import.meta.env.VITE_DFX_NETWORK
});

console.log('🔧 Using Canister IDs:', CANISTER_IDS);

// Detect if we're on the canister URL or localhost
const getHost = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.includes('localhost') || hostname === '127.0.0.1') {
      return 'http://localhost:4943';
    } else {
      // For mainnet deployment, use IC gateway
      return 'https://icp0.io';
    }
  }
  return 'http://localhost:4943';
};

const HOST = getHost();

// Debug logging for canister configuration
console.log('🔧 Canister Configuration:', {
  HOST,
  CANISTER_IDS,
  environment: HOST.includes('localhost') ? 'local' : 'mainnet'
});

export const useAuth = () => {
  const [authClient, setAuthClient] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [principal, setPrincipal] = useState(null);
  const [actor, setActor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stellarAddress, setStellarAddress] = useState(null);
  const [evmAddress, setEvmAddress] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);

  // Load cached address for the current user when authenticated
  useEffect(() => {
    if (principal) {
      const cacheKey = `kosh_stellar_address_${principal.toString()}`;
      const cachedAddress = localStorage.getItem(cacheKey);
      
      // Also check old cache format as fallback (from yesterday)
      const oldCacheKey = 'kosh_stellar_address';
      const oldCachedAddress = localStorage.getItem(oldCacheKey);
      
      if (cachedAddress) {
        try {
          const parsed = JSON.parse(cachedAddress);
          setStellarAddress(parsed);
          console.log('Loaded cached address for user:', principal.toString(), parsed.stellar_address);
        } catch (error) {
          console.warn('Failed to parse cached address:', error);
          localStorage.removeItem(cacheKey);
        }
      } else if (oldCachedAddress) {
        try {
          const parsed = JSON.parse(oldCachedAddress);
          setStellarAddress(parsed);
          // Migrate to new format
          localStorage.setItem(cacheKey, oldCachedAddress);
          localStorage.removeItem(oldCacheKey);
          console.log('Migrated old cached address for user:', principal.toString(), parsed.stellar_address);
        } catch (error) {
          console.warn('Failed to parse old cached address:', error);
          localStorage.removeItem(oldCacheKey);
        }
      }
    }
  }, [principal]);

  useEffect(() => {
    initializeAuth();
  }, []);

  const initializeAuth = async () => {
    try {
      console.log('Initializing auth client...');
      const client = await AuthClient.create({
        idleOptions: {
          disableIdle: false,
          idleTimeout: 30 * 60 * 1000, // 30 minutes
          disableDefaultIdleCallback: false
        }
      });
      setAuthClient(client);
      
      const isAuth = await client.isAuthenticated();
      console.log('Authentication status:', isAuth);
      setIsAuthenticated(isAuth);
      
      if (isAuth) {
        console.log('User is authenticated, setting up actor...');
        const identity = client.getIdentity();
        const userPrincipal = identity.getPrincipal();
        setPrincipal(userPrincipal);
        console.log('Principal:', userPrincipal.toString());
        
        // Create authenticated actor
        const agentOptions = {
          identity,
          host: HOST
        };
        
        // For local development, fetch root key; for mainnet, use hardcoded IC root key
        if (HOST.includes('localhost')) {
          agentOptions.fetchRootKey = true;
        }
        
        const authenticatedActor = createActor(CANISTER_IDS.BACKEND, {
          agentOptions,
        });
        setActor(authenticatedActor);
        console.log('Actor created successfully');
        
        // Auto-generate address if not cached for this user
        const userPrincipalStr = userPrincipal.toString();
        const cacheKey = `kosh_stellar_address_${userPrincipalStr}`;
        const cachedAddress = localStorage.getItem(cacheKey);
        console.log('Cache key:', cacheKey);
        console.log('Cached address:', cachedAddress ? 'Found' : 'Not found');
        
        if (!cachedAddress) {
          console.log('No cached address found for user, generating new address...');
          // Use setTimeout to ensure actor is set
          setTimeout(() => {
            generateStellarAddressAuto(authenticatedActor, userPrincipalStr);
          }, 100);
        } else {
          console.log('Using cached address');
          // Verify cached address matches backend - async verification
          setTimeout(async () => {
            try {
              const backendResult = await authenticatedActor.public_key_stellar();
              if (backendResult.Ok) {
                const parsedCache = JSON.parse(cachedAddress);
                if (backendResult.Ok !== parsedCache.stellar_address) {
                  console.warn('Cached address mismatch detected, refreshing...');
                  localStorage.removeItem(cacheKey);
                  generateStellarAddressAuto(authenticatedActor, userPrincipalStr);
                }
              }
            } catch (error) {
              console.warn('Address verification failed:', error);
            }
          }, 500);
        }
      } else {
        console.log('User is not authenticated');
      }
    } catch (error) {
      console.error('Error initializing auth:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = async (authMethod = 'passkey') => {
    if (!authClient) return;
    
    try {
      setLoading(true);
      
      // Configure login options based on auth method
      // Force Internet Identity production mode (only when FORCE_II_2_0=true in localStorage)
      const forceProductionII = localStorage.getItem('FORCE_II_2_0') === 'true';
      
      // For local development, always use local Internet Identity unless explicitly forced
      const identityProvider = import.meta.env.VITE_II_URL || 
        (HOST.includes('localhost') && !forceProductionII
          ? `http://${CANISTER_IDS.INTERNET_IDENTITY}.localhost:4943`
          : `https://identity.ic0.app`);
      
      console.log('Using Identity Provider:', identityProvider);
      console.log('Force Production II mode:', forceProductionII);
      
      const loginOptions = {
        identityProvider: identityProvider,
        maxTimeToLive: BigInt(7 * 24 * 60 * 60 * 1000 * 1000 * 1000), // 7 days in nanoseconds
        onSuccess: async () => {
          const identity = authClient.getIdentity();
          setPrincipal(identity.getPrincipal());
          setIsAuthenticated(true);
          
          // Create authenticated actor
          const agentOptions = {
            identity,
            host: HOST
          };
          
          // For local development, fetch root key; for mainnet, use hardcoded IC root key
          if (HOST.includes('localhost')) {
            agentOptions.fetchRootKey = true;
          }
          
          const authenticatedActor = createActor(CANISTER_IDS.BACKEND, {
            agentOptions,
          });
          setActor(authenticatedActor);
          
          // Auto-generate address if not cached for this user
          const userPrincipal = identity.getPrincipal().toString();
          const cacheKey = `kosh_stellar_address_${userPrincipal}`;
          const cachedAddress = localStorage.getItem(cacheKey);
          if (!cachedAddress) {
            console.log('No cached address found for user, generating new address...');
            // Use setTimeout to ensure actor is set
            setTimeout(() => {
              generateStellarAddressAuto(authenticatedActor, userPrincipal);
            }, 100);
          }
        },
      };

      // Add Google-specific configuration if using Google auth
      if (authMethod === 'google') {
        loginOptions.derivationOrigin = window.location.origin;
        loginOptions.windowOpenerFeatures = 'width=500,height=600,scrollbars=yes,resizable=yes';
      }

      await authClient.login(loginOptions);
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    if (!authClient) return;
    
    try {
      setLoading(true);
      await authClient.logout();
      
      // Clear cached address for this user before clearing principal
      if (principal) {
        const cacheKey = `kosh_stellar_address_${principal.toString()}`;
        localStorage.removeItem(cacheKey);
      }
      
      setIsAuthenticated(false);
      setPrincipal(null);
      setActor(null);
      setStellarAddress(null);
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateStellarAddressAuto = async (actorInstance = null, userPrincipal = null) => {
    const currentActor = actorInstance || actor;
    const currentPrincipal = userPrincipal || principal?.toString();
    
    if (!currentActor) {
      console.warn('No actor available for address generation');
      return;
    }
    
    if (!currentPrincipal) {
      console.warn('No principal available for address caching');
      return;
    }
    
    setWalletLoading(true);
    try {
      console.log('Generating Stellar address...', {
        host: HOST,
        canisterId: CANISTER_IDS.BACKEND,
        principal: currentPrincipal
      });
      
      console.log('Calling public_key_stellar...');
      const result = await currentActor.public_key_stellar();
      console.log('Backend response:', result);
      
      if (result.Ok) {
        const address = result.Ok;
        const addressData = { stellar_address: address };
        setStellarAddress(addressData);
        
        // Cache the address in localStorage with user-specific key
        const cacheKey = `kosh_stellar_address_${currentPrincipal}`;
        localStorage.setItem(cacheKey, JSON.stringify(addressData));
        console.log('Address generated and cached for user:', currentPrincipal, address);
        
        return addressData;
      } else {
        console.error('Backend returned error:', result.Err);
        throw new Error(result.Err);
      }
    } catch (error) {
      console.error('Failed to generate Stellar address:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      // Check for certificate verification errors (common with II 2.0 + local development)
      const errorMessage = error.message || '';
      if (errorMessage.includes('certificate verification failed') || 
          errorMessage.includes('Invalid delegation') ||
          errorMessage.includes('IcCanisterSignature signature could not be verified')) {
        
        const forceProductionII = localStorage.getItem('FORCE_II_2_0') === 'true';
        if (forceProductionII && HOST.includes('localhost')) {
          setStellarAddress({ 
            error: 'II 1.0 + Local Development Incompatibility',
            details: 'Internet Identity 1.0 (identity.ic0.app) cannot be used with local development. Please either:\n1. Switch to local II mode, or\n2. Deploy your backend to IC mainnet',
            suggestion: 'Turn off "Use II 1.0" toggle to continue with local development'
          });
          return;
        }
      }
      
      // Set general error state to show user
      setStellarAddress({ error: `Failed to generate address: ${error.message}` });
    } finally {
      setWalletLoading(false);
    }
  };

  const getStellarAddress = async () => {
    if (!actor) throw new Error('Not authenticated');
    if (!principal) throw new Error('No principal available');
    
    // Check cache first
    const cacheKey = `kosh_stellar_address_${principal.toString()}`;
    const cachedAddress = localStorage.getItem(cacheKey);
    if (cachedAddress) {
      try {
        const parsed = JSON.parse(cachedAddress);
        setStellarAddress(parsed);
        return parsed;
      } catch (error) {
        console.warn('Failed to parse cached address, regenerating...');
        localStorage.removeItem(cacheKey);
      }
    }
    
    // Generate new address
    return await generateStellarAddressAuto();
  };

  const getEvmAddress = async () => {
    if (!actor) throw new Error('Not authenticated');
    if (!principal) throw new Error('No principal available');
    
    try {
      setWalletLoading(true);
      console.log('🔗 Generating EVM address...');
      
      // Check cache first
      const cacheKey = `kosh_evm_address_${principal.toString()}`;
      const cachedAddress = localStorage.getItem(cacheKey);
      if (cachedAddress) {
        try {
          const parsed = JSON.parse(cachedAddress);
          setEvmAddress(parsed);
          console.log('📄 Using cached EVM address:', parsed.evm_address);
          return parsed;
        } catch (error) {
          console.warn('Failed to parse cached EVM address, regenerating...');
          localStorage.removeItem(cacheKey);
        }
      }
      
      // Generate new EVM address
      const result = await actor.generate_key_pair_evm();
      console.log('🔗 EVM address generation result:', result);
      
      if (result.Ok) {
        const evmData = {
          evm_address: result.Ok,
          timestamp: new Date().toISOString(),
          principal: principal.toString()
        };
        
        setEvmAddress(evmData);
        
        // Cache the result for this user
        localStorage.setItem(cacheKey, JSON.stringify(evmData));
        console.log('✅ EVM address generated and cached:', result.Ok);
        
        return evmData;
      } else {
        console.error('EVM address generation failed:', result.Err);
        throw new Error(result.Err || 'EVM address generation failed');
      }
    } catch (error) {
      console.error('Error generating EVM address:', error);
      throw error;
    } finally {
      setWalletLoading(false);
    }
  };

  const buildAndSubmitTransaction = async (destinationAddress, amount, network = 'testnet') => {
    if (!actor) throw new Error('Not authenticated');
    
    try {
      // Check if this is an EVM network transaction (by network name OR address format)
      const isEvmNetwork = network === 'holesky-testnet' || network === 'base-mainnet';
      const isEvmAddress = destinationAddress.startsWith('0x') && destinationAddress.length === 42;
      const isEvmTransaction = isEvmNetwork || isEvmAddress;
      
      if (isEvmTransaction) {
        // For EVM networks, use transfer_eth with the correct destination chain
        let destChain;
        if (network === 'holesky-testnet') {
          destChain = '17000';
        } else if (network === 'base-mainnet') {
          destChain = '8453';
        } else if (isEvmAddress) {
          // Default to Holesky for EVM addresses when network is not explicitly EVM
          destChain = '17000';
        }
        const amountFloat = parseFloat(amount);
        
        console.log('Sending EVM transaction with params:', { destinationAddress, amount: amountFloat, destChain, network });
        const result = await actor.transfer_eth(destinationAddress, amountFloat, destChain);
        console.log('EVM Backend response:', result);
        
        if (result.Ok) {
          return {
            success: true,
            message: 'ETH transaction submitted successfully!',
            hash: result.Ok,
            explorer_url: destChain === '17000' 
              ? `https://holesky.etherscan.io/tx/${result.Ok}` 
              : `https://basescan.org/tx/${result.Ok}`,
            raw_response: result.Ok,
            details: { hash: result.Ok, network, destChain }
          };
        } else {
          console.error('EVM Backend returned error:', result.Err);
          throw new Error(result.Err);
        }
      } else {
        // For Stellar networks, use existing logic
        // Send amount as string to preserve decimal precision
        
        console.log('Sending Stellar transaction with params:', { destinationAddress, amount, network });
        const result = await actor.build_stellar_transaction(destinationAddress, amount, [network]);
        console.log('Stellar Backend response:', result);
        
        if (result.Ok) {
        // Parse the JSON response from backend
        try {
          const responseData = JSON.parse(result.Ok);
          console.log('Parsed response data:', responseData);
          
          if (responseData.success) {
            return {
              success: true,
              message: responseData.hash ? 'Transaction submitted successfully!' : 'Transaction successful (hash pending)',
              hash: responseData.hash,
              explorer_url: responseData.explorer_url,
              raw_response: responseData.raw_response,
              details: responseData
            };
          } else {
            console.error('Transaction failed:', responseData);
            return {
              success: false,
              message: responseData.error || 'Transaction failed',
              raw_response: responseData.raw_response,
              details: responseData
            };
          }
        } catch (parseError) {
          console.warn('Failed to parse backend response as JSON:', parseError);
          console.log('Raw response:', result.Ok);
          
          // Fallback for non-JSON response - try to extract hash manually
          const hashMatch = result.Ok.match(/"hash"\s*:\s*"([^"]+)"/);
          const hash = hashMatch ? hashMatch[1] : null;
          
          const networkPath = network === 'mainnet' ? 'public' : 'testnet';
          return {
            success: true,
            message: hash ? 'Transaction submitted successfully!' : 'Transaction completed (parsing hash...)',
            hash: hash,
            explorer_url: hash ? `https://stellar.expert/explorer/${networkPath}/tx/${hash}` : null,
            raw_response: result.Ok,
            details: result.Ok
          };
        }
        } else {
          console.error('Backend returned error:', result.Err);
          throw new Error(result.Err);
        }
      }
    } catch (error) {
      console.error('Failed to build and submit transaction:', error);
      throw error;
    }
  };

  const getAccountBalance = async (network = 'testnet') => {
    if (!stellarAddress) {
      throw new Error('Stellar address not available');
    }
    
    try {
      console.log('Fetching balance directly from Stellar API for network:', network);
      const balance = await stellarGetAccountBalance(stellarAddress.stellar_address, network);
      console.log('Stellar API balance response:', balance);
      return balance;
    } catch (error) {
      console.error('Failed to get account balance from Stellar API:', error);
      throw error;
    }
  };

  const getEvmBalance = async (network = 'holesky-testnet') => {
    try {
      if (!evmAddress?.evm_address) {
        throw new Error('EVM address is not available');
      }
      
      // Determine RPC endpoint based on network
      const rpcUrl = network === 'holesky-testnet' 
        ? 'https://endpoints.omniatech.io/v1/eth/holesky/public'
        : 'https://base.drpc.org';
      
      console.log(`🔍 Fetching balance for ${evmAddress.evm_address} on ${network}`);
      console.log(`🌐 Using RPC: ${rpcUrl}`);
      
      // Call eth_getBalance via JSON-RPC
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [evmAddress.evm_address, 'latest'],
          id: 1
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message || 'RPC error');
      }
      
      // Convert from wei to ETH
      const balanceWei = BigInt(data.result);
      const balanceEth = Number(balanceWei) / Math.pow(10, 18);
      
      console.log(`💰 Balance: ${balanceEth} ETH (${data.result} wei)`);
      
      return balanceEth.toFixed(8);
    } catch (error) {
      console.error('Error fetching EVM balance:', error);
      throw error;
    }
  };

  return {
    isAuthenticated,
    principal,
    actor,
    loading,
    walletLoading,
    stellarAddress,
    evmAddress,
    login,
    logout,
    getStellarAddress,
    getEvmAddress,
    buildAndSubmitTransaction,
    getAccountBalance,
    getEvmBalance,
  };
}; 