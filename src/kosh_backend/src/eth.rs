use candid::Nat;
use ethabi::ethereum_types::{H160, U256};
use ethabi::{Address, Function, Param, ParamType, Token};
use ethers_core::types::{Bytes, Eip1559TransactionRequest, U64};
use hex;
use ic_cdk::api::call::call_with_payment128;
use ic_cdk::update;
use k256::PublicKey;
use sha2::Digest;
use std::str::FromStr;

use crate::evm_indexer::ChainService;
use crate::evm_rpc_bindings::GetTransactionCountResult;
use crate::evm_rpc_bindings::MultiGetTransactionCountResult;
use crate::evm_rpc_bindings::SendRawTransactionResult;
use crate::evm_rpc_bindings::{BlockTag, RpcServices};
use crate::evm_rpc_bindings::{
    EthSepoliaService, GetTransactionCountArgs, MultiSendRawTransactionResult, RpcApi,
    SendRawTransactionStatus,
};
use ic_cdk::api::management_canister::ecdsa::sign_with_ecdsa;
use ic_cdk::api::management_canister::ecdsa::EcdsaPublicKeyResponse;
use ic_cdk::api::management_canister::ecdsa::SignWithEcdsaResponse;
use ic_cdk::api::management_canister::ecdsa::{
    ecdsa_public_key, EcdsaCurve, EcdsaKeyId, EcdsaPublicKeyArgument, SignWithEcdsaArgument,
};
use num_traits::ToPrimitive;

use once_cell::sync::Lazy;
use std::sync::RwLock;

static TX_HASH: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));

const CONTRACT_ADDRESS_HEX: &str = "0x99a79158A40E4BEF8Beb3AcFAE893e62C45034E8";
const EIP1559_TX_ID: u8 = 2;

// Helper function to get RPC configuration based on destination chain
fn get_rpc_config(dest_chain: &str) -> (u64, String) {
    match dest_chain {
        "17000" => (
            17000,
            "https://ethereum-holesky-rpc.publicnode.com".to_string(),
        ),
        "8453" => (8453, "https://base.drpc.org".to_string()),
        _ => (
            17000,
            "https://ethereum-holesky-rpc.publicnode.com".to_string(),
        ), // Default to Holesky
    }
}

impl ChainService {
    async fn pubkey_and_signature(
        &self,
        tx_hash: Vec<u8>,
    ) -> Result<(Vec<u8>, SignWithEcdsaResponse), String> {
        let public_key_response = get_ecdsa_public_key().await?; // now a Result

        let (signature_response,) = sign_with_ecdsa(SignWithEcdsaArgument {
            message_hash: tx_hash,
            key_id: key_id(),
            ..Default::default()
        })
        .await
        .map_err(|e| format!("Failed to generate signature {:?}", e))?;

        Ok((public_key_response.public_key, signature_response))
    }

    async fn caller_pubkey_and_signature(
        &self,
        tx_hash: Vec<u8>,
    ) -> Result<(Vec<u8>, SignWithEcdsaResponse), String> {
        let public_key_response = get_caller_ecdsa_public_key().await?;

        let (signature_response,) = sign_with_ecdsa(SignWithEcdsaArgument {
            message_hash: tx_hash,
            derivation_path: vec![ic_cdk::api::caller().as_slice().to_vec()],
            key_id: key_id(),
            ..Default::default()
        })
        .await
        .map_err(|e| format!("Failed to generate signature {:?}", e))?;

        Ok((public_key_response.public_key, signature_response))
    }

    /// Fetch transaction count (nonce) for your IC Ethereum address (from secp256k1 pubkey)
    pub async fn fetch_tx_nonce(&self, dest_chain: &str) -> Result<Nat, String> {
        let block_tag = BlockTag::Latest;
        let (canister_address, _ecdsa_key) = get_network_config();
        ic_cdk::println!("canister_address {}", canister_address);
        let get_transaction_count_args = GetTransactionCountArgs {
            address: canister_address.to_string(),
            block: block_tag,
        };

        // Prepare cycles amount to pay for the call (adjust as necessary)
        let cycles: u128 = 200_000_000_000u128;

        // Get RPC configuration based on destination chain
        let (chain_id, rpc_url) = get_rpc_config(dest_chain);
        ic_cdk::println!("Using chain_id: {} and rpc_url: {}", chain_id, rpc_url);

        // The principal (canister ID) of the EVM RPC canister
        let evm_canister_id = self.evm_rpc.0;

        // Make cross-canister call with cycles payment
        let (transaction_result,) = call_with_payment128::<
            (
                RpcServices,
                Option<crate::evm_rpc_bindings::RpcConfig>,
                GetTransactionCountArgs,
            ),
            (MultiGetTransactionCountResult,),
        >(
            evm_canister_id,
            "eth_getTransactionCount",
            (
                RpcServices::Custom {
                    chainId: chain_id,
                    services: vec![RpcApi {
                        url: rpc_url,
                        headers: None,
                    }],
                },
                None,
                get_transaction_count_args.clone(),
            ),
            cycles,
        )
        .await
        .map_err(|e| format!("Failed to get transaction count: {:?}", e))?;

        // Handle possible result variants
        let transaction_count = match transaction_result {
            MultiGetTransactionCountResult::Consistent(consistent_result) => {
                match consistent_result {
                    GetTransactionCountResult::Ok(count) => count,
                    GetTransactionCountResult::Err(error) => {
                        return Err(format!(
                            "failed to get transaction count for {:?}, error: {:?}",
                            get_transaction_count_args, error
                        ));
                    }
                }
            }
            MultiGetTransactionCountResult::Inconsistent(inconsistent_results) => {
                return Err(format!(
                    "inconsistent results when retrieving transaction count for {:?}. Received results: {:?}",
                    get_transaction_count_args,
                    inconsistent_results
                ));
            }
        };

        Ok(transaction_count)
    }

    /// Fetch transaction count (nonce) for caller's address using derivation path
    pub async fn fetch_caller_tx_nonce(&self, dest_chain: &str) -> Result<Nat, String> {
        let block_tag = BlockTag::Latest;
        
        // Get caller's Ethereum address
        let caller_address = get_caller_ethereum_address().await?;
        ic_cdk::println!("caller_address {}", caller_address);
        
        let get_transaction_count_args = GetTransactionCountArgs {
            address: caller_address,
            block: block_tag,
        };

        // Prepare cycles amount to pay for the call (adjust as necessary)
        let cycles: u128 = 200_000_000_000u128;

        // Get RPC configuration based on destination chain
        let (chain_id, rpc_url) = get_rpc_config(dest_chain);
        ic_cdk::println!("Using chain_id: {} and rpc_url: {}", chain_id, rpc_url);

        // The principal (canister ID) of the EVM RPC canister
        let evm_canister_id = self.evm_rpc.0;

        // Make cross-canister call with cycles payment
        let (transaction_result,) = call_with_payment128::<
            (
                RpcServices,
                Option<crate::evm_rpc_bindings::RpcConfig>,
                GetTransactionCountArgs,
            ),
            (MultiGetTransactionCountResult,),
        >(
            evm_canister_id,
            "eth_getTransactionCount",
            (
                RpcServices::Custom {
                    chainId: chain_id,
                    services: vec![RpcApi {
                        url: rpc_url,
                        headers: None,
                    }],
                },
                None,
                get_transaction_count_args.clone(),
            ),
            cycles,
        )
        .await
        .map_err(|e| format!("Failed to get transaction count: {:?}", e))?;

        // Handle possible result variants
        let transaction_count = match transaction_result {
            MultiGetTransactionCountResult::Consistent(consistent_result) => {
                match consistent_result {
                    GetTransactionCountResult::Ok(count) => count,
                    GetTransactionCountResult::Err(error) => {
                        return Err(format!(
                            "failed to get transaction count for {:?}, error: {:?}",
                            get_transaction_count_args, error
                        ));
                    }
                }
            }
            MultiGetTransactionCountResult::Inconsistent(inconsistent_results) => {
                return Err(format!(
                    "inconsistent results when retrieving transaction count for {:?}. Received results: {:?}",
                    get_transaction_count_args,
                    inconsistent_results
                ));
            }
        };

        Ok(transaction_count)
    }

    pub async fn send_eth_evm(
        &self,
        to: String,
        amount: String,
        dest_chain: String,
    ) -> Result<String, String> {
        use ethers_core::types::U256;

        ic_cdk::println!("dest_chain {}", dest_chain);

        // 4. Get nonce for from address
        let nonce = self.fetch_tx_nonce(&dest_chain).await?;
        ic_cdk::println!("Nonce for address: {}", nonce);

        ic_cdk::println!("AMOUNT {}", amount);

        // 5. Estimate gas fees (implement your own or hardcode)
        let (gas_limit, max_fee_per_gas, max_priority_fee_per_gas) =
            estimate_transaction_fees().await;

        // Get chain ID for the transaction
        let (chain_id, _) = get_rpc_config(&dest_chain);
        ic_cdk::println!("Building transaction for chain_id: {}", chain_id);

        // 6. Build the EIP-1559 transaction request
        let tx = Eip1559TransactionRequest {
            from: None,
            to: Some(H160::from_str(&to).map_err(|e| format!("Invalid address format: {}", e))?.into()),
            nonce: Some(U256::from(nonce.0.to_u64().unwrap())),
            gas: Some(U256::from(gas_limit)),
            max_fee_per_gas: Some(U256::from(max_fee_per_gas)),
            max_priority_fee_per_gas: Some(U256::from(max_priority_fee_per_gas)),
            value: Some({
                // Convert ETH decimal amount to wei for transaction
                let eth_amount: f64 = amount.parse().map_err(|e| format!("Invalid ETH amount: {}", e))?;
                let wei_amount = (eth_amount * 1e18) as u128;
                U256::from(wei_amount)
            }),
            data: Default::default(),
            access_list: vec![].into(),
            chain_id: Some(U64::from(chain_id)),
        };

        // 7. RLP encode the unsigned transaction and prefix with EIP1559 tx id (0x02)
        let mut unsigned_tx = tx.rlp().to_vec();
        unsigned_tx.insert(0, EIP1559_TX_ID);

        // 8. Generate the transaction hash to sign (keccak256 of the unsigned_tx)
        let tx_hash = ethers_core::utils::keccak256(&unsigned_tx);

        // 9. Sign the transaction hash with IC ECDSA key
        let (public_key_bytes, signature) = self.pubkey_and_signature(tx_hash.to_vec()).await?;

        // 10. Recover y parity (v) from signature
        let y_parity = y_parity(&tx_hash, &signature.signature, &public_key_bytes);

        // 11. Create ethers Signature struct with r,s,v
        let sig = ethers_core::types::Signature {
            r: U256::from_big_endian(&signature.signature[0..32]),
            s: U256::from_big_endian(&signature.signature[32..64]),
            v: y_parity as u64,
        };

        // 12. RLP encode the signed transaction and prefix with tx id
        let mut signed_tx = tx.rlp_signed(&sig).to_vec();
        signed_tx.insert(0, EIP1559_TX_ID);

        let raw_tx_hex = format!("0x{}", hex::encode(&signed_tx));

        ic_cdk::println!("Raw signed transaction hex: {}", raw_tx_hex);

        let cycles_to_pay: u128 = 600_000_000_000;

        // Get RPC configuration for sending the transaction
        let (chain_id, rpc_url) = get_rpc_config(&dest_chain);
        ic_cdk::println!(
            "Sending transaction to chain_id: {} with rpc_url: {}",
            chain_id,
            rpc_url
        );

        // 13. Send the raw transaction using your evm_rpc canister's eth_sendRawTransaction
        let (send_result,) = call_with_payment128::<
            (
                RpcServices,
                Option<crate::evm_rpc_bindings::RpcConfig>,
                String,
            ),
            (MultiSendRawTransactionResult,),
        >(
            self.evm_rpc.0, // the canister principal of your evm_rpc canister
            "eth_sendRawTransaction",
            (
                RpcServices::Custom {
                    chainId: chain_id,
                    services: vec![RpcApi {
                        url: rpc_url,
                        headers: None,
                    }],
                },
                None,
                raw_tx_hex,
            ),
            cycles_to_pay, // send cycles for payment here
        )
        .await
        .map_err(|e| format!("Failed to send raw transaction: {:?}", e))?;

        // 14. Parse result from send
        match send_result {
            MultiSendRawTransactionResult::Consistent(send_status) => match send_status {
                SendRawTransactionResult::Ok(SendRawTransactionStatus::Ok(opt_tx_hash)) => {
                    if let Some(tx_hash) = opt_tx_hash {
                        {
                            let mut hash = TX_HASH.write().unwrap();
                            *hash = Some(tx_hash.clone());
                        }

                        ic_cdk::println!(
                            "✅ Transaction sent successfully, tx hash: {:?}",
                            tx_hash
                        );
                        Ok(tx_hash)
                    } else {
                        Err("Error: transaction hash not found in the response".to_string())
                    }
                }
                SendRawTransactionResult::Ok(SendRawTransactionStatus::NonceTooLow) => {
                    Err("Error: nonce too low".to_string())
                }
                SendRawTransactionResult::Ok(SendRawTransactionStatus::NonceTooHigh) => {
                    Err("Error: nonce too high".to_string())
                }
                SendRawTransactionResult::Ok(SendRawTransactionStatus::InsufficientFunds) => {
                    Err("Error: insufficient funds".to_string())
                }
                SendRawTransactionResult::Err(rpc_error) => {
                    Err(format!("RPC error sending transaction: {:?}", rpc_error))
                }
            },
            MultiSendRawTransactionResult::Inconsistent(_) => {
                Err("Inconsistent send raw transaction results".to_string())
            }
        }
    }

    pub async fn transfer_eth(
        &self,
        to: String,
        amount: String,
        dest_chain: String,
    ) -> Result<String, String> {
        use ethers_core::types::U256;

        ic_cdk::println!("🔄 transfer_eth - dest_chain: {}", dest_chain);
        ic_cdk::println!("🔄 transfer_eth - caller: {}", ic_cdk::api::caller());
        
        // Get caller's Ethereum address for logging
        let caller_eth_address = get_caller_ethereum_address().await?;
        ic_cdk::println!("🔄 transfer_eth - caller_eth_address: {}", caller_eth_address);

        // Get nonce for caller's address
        let nonce = self.fetch_caller_tx_nonce(&dest_chain).await?;
        ic_cdk::println!("Caller nonce: {}", nonce);

        ic_cdk::println!("AMOUNT {}", amount);

        // Estimate gas fees based on destination chain
        let (gas_limit, max_fee_per_gas, max_priority_fee_per_gas) =
            estimate_transaction_fees_for_chain(&dest_chain).await;

        ic_cdk::println!("Gas fees - limit: {}, max_fee: {}, priority_fee: {}", gas_limit, max_fee_per_gas, max_priority_fee_per_gas);

        // Get chain ID for the transaction
        let (chain_id, rpc_url) = get_rpc_config(&dest_chain);
        ic_cdk::println!("Building transaction for chain_id: {} with RPC: {}", chain_id, rpc_url);

        // Build the EIP-1559 transaction request
        let tx = Eip1559TransactionRequest {
            from: None,
            to: Some(H160::from_str(&to).map_err(|e| format!("Invalid address format: {}", e))?.into()),
            nonce: Some(U256::from(nonce.0.to_u64().unwrap())),
            gas: Some(U256::from(gas_limit)),
            max_fee_per_gas: Some(U256::from(max_fee_per_gas)),
            max_priority_fee_per_gas: Some(U256::from(max_priority_fee_per_gas)),
            value: Some({
                // Convert ETH decimal amount to wei for transaction
                let eth_amount: f64 = amount.parse().map_err(|e| format!("Invalid ETH amount: {}", e))?;
                let wei_amount = (eth_amount * 1e18) as u128;
                U256::from(wei_amount)
            }),
            data: Default::default(),
            access_list: vec![].into(),
            chain_id: Some(U64::from(chain_id)),
        };

        // RLP encode the unsigned transaction and prefix with EIP1559 tx id (0x02)
        let mut unsigned_tx = tx.rlp().to_vec();
        unsigned_tx.insert(0, EIP1559_TX_ID);

        // Generate the transaction hash to sign (keccak256 of the unsigned_tx)
        let tx_hash = ethers_core::utils::keccak256(&unsigned_tx);

        // Sign the transaction hash with caller's IC ECDSA key (using derivation path)
        let (public_key_bytes, signature) = self.caller_pubkey_and_signature(tx_hash.to_vec()).await?;

        // Recover y parity (v) from signature
        let y_parity = y_parity(&tx_hash, &signature.signature, &public_key_bytes);

        // Create ethers Signature struct with r,s,v
        let sig = ethers_core::types::Signature {
            r: U256::from_big_endian(&signature.signature[0..32]),
            s: U256::from_big_endian(&signature.signature[32..64]),
            v: y_parity as u64,
        };

        // RLP encode the signed transaction and prefix with tx id
        let mut signed_tx = tx.rlp_signed(&sig).to_vec();
        signed_tx.insert(0, EIP1559_TX_ID);

        let raw_tx_hex = format!("0x{}", hex::encode(&signed_tx));

        ic_cdk::println!("Raw signed transaction hex: {}", raw_tx_hex);

        let cycles_to_pay: u128 = 600_000_000_000;

        // Get RPC configuration for sending the transaction
        let (chain_id, rpc_url) = get_rpc_config(&dest_chain);
        ic_cdk::println!(
            "Sending transaction to chain_id: {} with rpc_url: {}",
            chain_id,
            rpc_url
        );

        // Send the raw transaction using evm_rpc canister's eth_sendRawTransaction
        let (send_result,) = call_with_payment128::<
            (
                RpcServices,
                Option<crate::evm_rpc_bindings::RpcConfig>,
                String,
            ),
            (MultiSendRawTransactionResult,),
        >(
            self.evm_rpc.0,
            "eth_sendRawTransaction",
            (
                RpcServices::Custom {
                    chainId: chain_id,
                    services: vec![RpcApi {
                        url: rpc_url,
                        headers: None,
                    }],
                },
                None,
                raw_tx_hex,
            ),
            cycles_to_pay,
        )
        .await
        .map_err(|e| format!("Failed to send raw transaction: {:?}", e))?;

        // Parse result from send
        match send_result {
            MultiSendRawTransactionResult::Consistent(send_status) => match send_status {
                SendRawTransactionResult::Ok(SendRawTransactionStatus::Ok(opt_tx_hash)) => {
                    if let Some(tx_hash) = opt_tx_hash {
                        ic_cdk::println!(
                            "✅ Transfer transaction sent successfully, tx hash: {:?}",
                            tx_hash
                        );
                        Ok(tx_hash)
                    } else {
                        Err("Error: transaction hash not found in the response".to_string())
                    }
                }
                SendRawTransactionResult::Ok(SendRawTransactionStatus::NonceTooLow) => {
                    Err("Error: nonce too low".to_string())
                }
                SendRawTransactionResult::Ok(SendRawTransactionStatus::NonceTooHigh) => {
                    Err("Error: nonce too high".to_string())
                }
                SendRawTransactionResult::Ok(SendRawTransactionStatus::InsufficientFunds) => {
                    Err("Error: insufficient funds".to_string())
                }
                SendRawTransactionResult::Err(rpc_error) => {
                    Err(format!("RPC error sending transaction: {:?}", rpc_error))
                }
            },
            MultiSendRawTransactionResult::Inconsistent(_) => {
                Err("Inconsistent send raw transaction results".to_string())
            }
        }
    }

}


#[update]
pub async fn generate_canister_key_pair_evm() -> Result<String, String> {
    let (_, ecdsa_key) = get_network_config();

    let request = EcdsaPublicKeyArgument {
        key_id: EcdsaKeyId {
            curve: EcdsaCurve::Secp256k1,
            name: ecdsa_key.to_string(),
        },
        derivation_path: vec![],
        ..Default::default()
    };

    let (response,) = ecdsa_public_key(request)
        .await
        .map_err(|e| format!("ecdsa_public_key failed {:?}", e))?;

    ic_cdk::println!("ECDSA public key response: {:?}", response);

    let public_key_hex = hex::encode(&response.public_key);

    ic_cdk::println!("Derived public key hex: {}", public_key_hex);

    let ethereum_address = pubkey_bytes_to_address(&response.public_key);

    Ok(ethereum_address)
}


#[update]
pub async fn generate_key_pair_evm() -> Result<String, String> {
    let (_, ecdsa_key) = get_network_config();

    let request = EcdsaPublicKeyArgument {
        key_id: EcdsaKeyId {
            curve: EcdsaCurve::Secp256k1,
            name: ecdsa_key.to_string(),
        },
        derivation_path: vec![ic_cdk::api::caller().as_slice().to_vec()],
        ..Default::default()
    };

    let (response,) = ecdsa_public_key(request)
        .await
        .map_err(|e| format!("ecdsa_public_key failed {:?}", e))?;

    ic_cdk::println!("ECDSA public key response: {:?}", response);

    let public_key_hex = hex::encode(&response.public_key);

    ic_cdk::println!("Derived public key hex: {}", public_key_hex);

    let ethereum_address = pubkey_bytes_to_address(&response.public_key);

    Ok(ethereum_address)
}

/// Derive Ethereum address from uncompressed secp256k1 public key bytes (65 bytes, 0x04 prefix)

fn pubkey_bytes_to_address(pubkey_bytes: &[u8]) -> String {
    use k256::elliptic_curve::sec1::ToEncodedPoint;
    use sha3::Keccak256;

    let key =
        PublicKey::from_sec1_bytes(pubkey_bytes).expect("failed to parse the public key as SEC1");
    let point = key.to_encoded_point(false);
    let point_bytes = point.as_bytes();
    assert_eq!(point_bytes[0], 0x04);

    let hash = Keccak256::digest(&point_bytes[1..]);

    let address = Address::from_slice(&hash[12..32]);
    ethers_core::utils::to_checksum(&address.into(), None)
}

pub async fn estimate_transaction_fees() -> (u128, u128, u128) {
    const GAS_LIMIT: u128 = 1_500_000; // 150k gas
    const MAX_FEE_PER_GAS: u128 = 200_000_000_000; // 200 Gwei
    const MAX_PRIORITY_FEE_PER_GAS: u128 = 50_000_000_000; // 50 Gwei

    (GAS_LIMIT, MAX_FEE_PER_GAS, MAX_PRIORITY_FEE_PER_GAS)
}

pub async fn estimate_transaction_fees_for_chain(dest_chain: &str) -> (u128, u128, u128) {
    match dest_chain {
        "17000" => {
            // Holesky Testnet - Lower fees for testnet
            const GAS_LIMIT: u128 = 21_000; // Standard ETH transfer
            const MAX_FEE_PER_GAS: u128 = 20_000_000_000; // 20 Gwei
            const MAX_PRIORITY_FEE_PER_GAS: u128 = 2_000_000_000; // 2 Gwei
            (GAS_LIMIT, MAX_FEE_PER_GAS, MAX_PRIORITY_FEE_PER_GAS)
        },
        "8453" => {
            // Base Mainnet - Optimized fees
            const GAS_LIMIT: u128 = 21_000; // Standard ETH transfer
            const MAX_FEE_PER_GAS: u128 = 1_000_000_000; // 1 Gwei (Base is cheaper)
            const MAX_PRIORITY_FEE_PER_GAS: u128 = 1_000_000_000; // 1 Gwei
            (GAS_LIMIT, MAX_FEE_PER_GAS, MAX_PRIORITY_FEE_PER_GAS)
        },
        _ => {
            // Default fallback
            const GAS_LIMIT: u128 = 21_000;
            const MAX_FEE_PER_GAS: u128 = 20_000_000_000; // 20 Gwei
            const MAX_PRIORITY_FEE_PER_GAS: u128 = 2_000_000_000; // 2 Gwei
            (GAS_LIMIT, MAX_FEE_PER_GAS, MAX_PRIORITY_FEE_PER_GAS)
        }
    }
}

fn y_parity(prehash: &[u8], sig: &[u8], pubkey: &[u8]) -> u64 {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

    let orig_key = VerifyingKey::from_sec1_bytes(pubkey).expect("failed to parse the pubkey");
    let signature = Signature::try_from(sig).unwrap();
    for parity in [0u8, 1] {
        let recid = RecoveryId::try_from(parity).unwrap();
        let recovered_key = VerifyingKey::recover_from_prehash(prehash, &signature, recid)
            .expect("failed to recover key");
        if recovered_key == orig_key {
            return parity as u64;
        }
    }

    panic!(
        "failed to recover the parity bit from a signature; sig: {}, pubkey: {}",
        hex::encode(sig),
        hex::encode(pubkey)
    )
}

const NETWORK: &str = "mainnet";
pub fn get_network_config() -> (&'static str, &'static str) {
    match NETWORK {
        "local" => (
            "0xDa824f554C42ecd28a74A037c70FA0b5bf447bB0", // address_local
            "dfx_test_key",                               // ecdsa_key_local
        ),
        "mainnet" => (
            "0x4f159ACaC4105822E3201674FD2323320Bb9dd38", // address_main
            "test_key_1",                                 // ecdsa_key_main
        ),
        _ => panic!("Unknown network!"),
    }
}

pub async fn get_ecdsa_public_key() -> Result<EcdsaPublicKeyResponse, String> {
    let res = ecdsa_public_key(EcdsaPublicKeyArgument {
        key_id: key_id(),
        ..Default::default()
    })
    .await
    .map_err(|e| format!("Failed to get public key: {:?}", e))?;

    Ok(res.0)
}

pub async fn get_caller_ecdsa_public_key() -> Result<EcdsaPublicKeyResponse, String> {
    let res = ecdsa_public_key(EcdsaPublicKeyArgument {
        key_id: key_id(),
        derivation_path: vec![ic_cdk::api::caller().as_slice().to_vec()],
        ..Default::default()
    })
    .await
    .map_err(|e| format!("Failed to get caller public key: {:?}", e))?;

    Ok(res.0)
}

pub async fn get_caller_ethereum_address() -> Result<String, String> {
    let public_key_response = get_caller_ecdsa_public_key().await?;
    let ethereum_address = pubkey_bytes_to_address(&public_key_response.public_key);
    Ok(ethereum_address)
}

// Wrapper function to call ChainService send_eth_evm method


pub async fn send_eth_evm(to: String, amount: f64, dest_chain: String) -> Result<String, String> {
    use crate::evm_indexer::{ChainService, CHAIN_SERVICE};

    let chain_service = CHAIN_SERVICE.with(|service| {
        let mut service = service.borrow_mut();
        if service.is_none() {
            let canister_id = ic_cdk::api::id().to_string();
            *service = Some(ChainService::new(canister_id));
        }
        service.clone()
    });

    if let Some(service) = chain_service {
        // Amount is passed as ETH decimal string (e.g. "0.00008109335274785089")

        service
            .send_eth_evm(to, amount.to_string(), dest_chain)
            .await
    } else {
        Err("Failed to initialize chain service".to_string())
    }
}

// Wrapper function to call ChainService transfer_eth method with caller derivation path
#[ic_cdk::update]
pub async fn transfer_eth(to: String, amount: f64, dest_chain: String) -> Result<String, String> {
    use crate::evm_indexer::{ChainService, CHAIN_SERVICE};

    let chain_service = CHAIN_SERVICE.with(|service| {
        let mut service = service.borrow_mut();
        if service.is_none() {
            let canister_id = ic_cdk::api::id().to_string();
            *service = Some(ChainService::new(canister_id));
        }
        service.clone()
    });

    if let Some(service) = chain_service {
        // Amount is passed as ETH decimal string (e.g. "0.00008109335274785089")
        service
            .transfer_eth(to, amount.to_string(), dest_chain)
            .await
    } else {
        Err("Failed to initialize chain service".to_string())
    }
}

fn key_id() -> EcdsaKeyId {
    EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: "test_key_1".to_string(), // use EcdsaKeyId::default() for mainnet use test_key_1 for testnet and test_key_1 for local deployment
    }
}

pub async fn holesky_txn() -> Result<String, String> {
    let hash = TX_HASH.read().unwrap();
    if let Some(ref txn) = *hash {
        ic_cdk::println!("Returning latest Holesky tx hash: {}", txn);
        Ok(txn.clone())
    } else {
        Err("No transaction hash stored.".to_string())
    }
}
