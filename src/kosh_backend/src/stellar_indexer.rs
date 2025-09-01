use candid::CandidType;
use hex;
use ic_cdk::api::management_canister::http_request::{
    http_request, CanisterHttpRequestArgument, HttpHeader, HttpMethod, HttpResponse, TransformArgs,
    TransformContext,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::str::FromStr;
use stellar_xdr::curr;

use crate::eth::send_eth_evm;

// Contract IDs for different networks
const TESTNET_CONTRACT_ID: &str = "CDTA5IYGUGRI4PAGXJL7TPBEIC3EZY6V23ILF5EDVXFVLCGGMVOK4CRL";
const MAINNET_CONTRACT_ID: &str = "CDMHKRFQPMCBZFY225BNLNXA6YRTOCDD2VDC2AXC4YP3XCYMLYZAHWDS";

// RPC endpoint URLs for different networks
const TESTNET_RPC_URL: &str = "https://soroban-testnet.stellar.org";
const MAINNET_RPC_URL: &str = "https://soroban-mainnet.stellar.org";

// Helper function to get contract ID and RPC URL based on destination chain
fn get_stellar_config(destination_chain: &str) -> (&str, &str) {
    match destination_chain {
        "17000" => (TESTNET_CONTRACT_ID, TESTNET_RPC_URL), // Holesky -> Stellar Testnet
        "8453" => (MAINNET_CONTRACT_ID, MAINNET_RPC_URL),  // Base -> Stellar Mainnet
        _ => (TESTNET_CONTRACT_ID, TESTNET_RPC_URL),       // Default to testnet
    }
}

// Store events in memory
thread_local! {
    static EVENTS: RefCell<HashMap<String, CandidContractEvent>> = RefCell::new(HashMap::new());
}

// Request structure for the JSON-RPC call
#[derive(Serialize, Debug)]
struct GetEventsRequest {
    jsonrpc: String,
    id: u32,
    method: String,
    params: GetEventsParams,
}

#[derive(Serialize, Debug)]
struct GetEventsParams {
    #[serde(rename = "startLedger")]
    start_ledger: u32,
    #[serde(rename = "endLedger")]
    end_ledger: u32,
    #[serde(rename = "xdrFormat")]
    xdr_format: String,
    filters: Vec<EventFilter>,
    pagination: PaginationOptions,
}

#[derive(Serialize, Debug)]
struct EventFilter {
    #[serde(rename = "type")]
    filter_type: String,
    #[serde(rename = "contractIds")]
    contract_ids: Vec<String>,
    topics: Vec<String>,
}

#[derive(Serialize, Debug)]
struct PaginationOptions {
    limit: u32,
}

// Response structures for the JSON-RPC result
#[derive(Deserialize, Debug, Clone)]
struct RpcResponse {
    id: u32,
    result: EventsResponse,
}

#[derive(Deserialize, Debug, Clone)]
struct EventsResponse {
    events: Vec<ContractEvent>,
    latest_ledger: u32,
}

#[derive(Deserialize, Debug, Clone)]
struct ContractEvent {
    contract_id: String,
    id: String,
    ledger: u32,
    topic: Vec<String>,
    value: EventValue,
    paging_token: String,
}

#[derive(Deserialize, Debug, Clone)]
struct EventValue {
    xdr: String,
}

// Candid-compatible types for the interface
#[derive(Debug, Clone, CandidType)]
pub struct CandidContractEvent {
    pub contract_id: String,
    pub id: String,
    pub ledger: u32,
    pub topic: Vec<String>,
    pub xdr_value: String,
    pub paging_token: String,
}

impl From<ContractEvent> for CandidContractEvent {
    fn from(event: ContractEvent) -> Self {
        CandidContractEvent {
            contract_id: event.contract_id,
            id: event.id,
            ledger: event.ledger,
            topic: event.topic,
            xdr_value: event.value.xdr,
            paging_token: event.paging_token,
        }
    }
}

// Define the transform function for HTTP responses

#[derive(Serialize, Debug)]
struct GetLatestLedgerRequest {
    jsonrpc: String,
    id: u32,
    method: String,
}


#[ic_cdk::update]
async fn fetch_stellar_events(ledger: u32, destination_chain: String) -> Result<String, String> {
    ic_cdk::println!(
        "🔍 Starting stellar events monitoring for ledger: {}",
        ledger
    );
    ic_cdk::println!("📋 Destination chain: {}", destination_chain);

    // Get the correct contract ID and RPC URL based on destination chain
    let (contract_id, rpc_url) = get_stellar_config(&destination_chain);
    ic_cdk::println!("Using contract ID: {}", contract_id);
    ic_cdk::println!("Using RPC URL: {}", rpc_url);

    // Try with SINGLE event limit to reduce response size and avoid consensus issues
    match fetch_stellar_events_single_attempt(ledger, contract_id, rpc_url, &destination_chain)
        .await
    {
        Ok(result) => return Ok(result),
        Err(err) => {
            ic_cdk::println!("⚠️ Events fetch failed: {}", err);

            // If it's a consensus error, log details but continue bridge flow
            if err.contains("No consensus could be reached") {
                ic_cdk::println!("❌ CONSENSUS ERROR DETAILS:");
                ic_cdk::println!("   - Ledger being queried: {}", ledger);
                ic_cdk::println!("   - Contract ID: {}", contract_id);
                ic_cdk::println!("   - RPC URL: {}", rpc_url);
                ic_cdk::println!("   - Full error: {}", err);
                ic_cdk::println!("💡 CONTINUING: Bridge flow proceeding despite consensus issues");
                return Ok(format!(
                    "Events fetch had consensus issues but bridge can continue. Ledger: {}",
                    ledger
                ));
            }

            // For non-consensus errors, return the error
            Err(err)
        }
    }
}

async fn fetch_stellar_events_single_attempt(
    ledger: u32,
    contract_id: &str,
    rpc_url: &str,
    destination_chain: &str,
) -> Result<String, String> {
    let mut result_summary = String::new();

    let request = GetEventsRequest {
        jsonrpc: "2.0".to_string(),
        id: 8675309,
        method: "getEvents".to_string(),
        params: GetEventsParams {
            start_ledger: ledger,
            end_ledger: ledger + 5, // Search in range: current ledger + next 5 ledgers for events
            xdr_format: "json".to_string(),
            filters: vec![EventFilter {
                filter_type: "contract".to_string(),
                contract_ids: vec![contract_id.to_string()],
                topics: vec![],
            }],
            pagination: PaginationOptions {
                limit: 10, // ← Fetch up to 10 events to increase chances of finding lock events
            },
        },
    };

    let request_body = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;
    ic_cdk::println!("Request body: {}", request_body);
    ic_cdk::println!(
        "🔍 Querying specific ledger: {} (not using latestLedger from response)",
        ledger
    );

    let request_headers = vec![HttpHeader {
        name: "Content-Type".to_string(),
        value: "application/json".to_string(),
    }];

    let request_arg = CanisterHttpRequestArgument {
        url: rpc_url.to_string(),
        method: HttpMethod::POST,
        body: Some(request_body.into_bytes()),
        max_response_bytes: Some(2_000_000),
        transform: Some(TransformContext::from_name(
            "transform_stellar_response".to_string(),
            vec![],
        )),
        headers: request_headers,
    };

    match ic_cdk::api::management_canister::http_request::http_request(
        request_arg,
        25_000_000_000, // Reduced cycles to avoid timeout
    )
    .await
    {
        Ok((response,)) => {
            if let Ok(response_body) = String::from_utf8(response.body.clone()) {
                ic_cdk::println!("RESPONSE_BODY {:?}", response_body);
                if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(&response_body) {
                    if let Some(result) = json_value.get("result") {
                        ic_cdk::println!("Result: {:?}", result);
                        if let Some(events) = result.get("events") {
                            ic_cdk::println!("Events: {:?}", events);
                            if let Some(events_array) = events.as_array() {
                                if !events_array.is_empty() {
                                    for event in events_array {
                                        ic_cdk::println!("\n=== EVENT DETAILS ===");
                                        ic_cdk::println!(
                                            "Transaction Hash: {}",
                                            event
                                                .get("txHash")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("N/A")
                                        );
                                        ic_cdk::println!(
                                            "Event ID: {}",
                                            event
                                                .get("id")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("N/A")
                                        );

                                        if let Some(value_json) = event.get("valueJson") {
                                            if let Some(map) =
                                                value_json.get("map").and_then(|m| m.as_array())
                                            {
                                                let mut dest_address = String::new();
                                                let mut amount_to_send: f64 = 0.0;
                                                let mut dest_chain: u64 = 0;

                                                for item in map {
                                                    if let Some(key) = item
                                                        .get("key")
                                                        .and_then(|k| k.get("symbol"))
                                                        .and_then(|s| s.as_str())
                                                    {
                                                        match key {
                                                            "dest_chain" => {
                                                                if let Some(bytes) = item
                                                                    .get("val")
                                                                    .and_then(|v| v.get("bytes"))
                                                                    .and_then(|b| b.as_str())
                                                                {
                                                                    if let Ok(decimal) =
                                                                        u64::from_str_radix(
                                                                            bytes, 16,
                                                                        )
                                                                    {
                                                                        ic_cdk::println!(
                                                                            "Destination Chain: {}",
                                                                            decimal
                                                                        );
                                                                        dest_chain = decimal;
                                                                    }
                                                                }
                                                            }
                                                            "dest_token" => {
                                                                if let Some(token) = item
                                                                    .get("val")
                                                                    .and_then(|v| v.get("string"))
                                                                    .and_then(|s| s.as_str())
                                                                {
                                                                    ic_cdk::println!(
                                                                        "Destination Token: {}",
                                                                        token
                                                                    );
                                                                }
                                                            }
                                                            "from_token" => {
                                                                if let Some(addr) = item
                                                                    .get("val")
                                                                    .and_then(|v| v.get("address"))
                                                                    .and_then(|s| s.as_str())
                                                                {
                                                                    ic_cdk::println!(
                                                                        "From Token: {}",
                                                                        addr
                                                                    );
                                                                }
                                                            }
                                                            "in_amount" => {
                                                                // Handle different i128 formats
                                                                if let Some(i128_val) = item
                                                                    .get("val")
                                                                    .and_then(|v| v.get("i128"))
                                                                {
                                                                    let amount_val =
                                                                        if let Some(amount_str) =
                                                                            i128_val.as_str()
                                                                        {
                                                                            // i128 as string: "110000000"
                                                                            amount_str
                                                                                .parse::<u64>()
                                                                                .unwrap_or(0)
                                                                        } else if let Some(
                                                                            amount_num,
                                                                        ) =
                                                                            i128_val.as_u64()
                                                                        {
                                                                            // i128 as number: 110000000
                                                                            amount_num
                                                                        } else if let Some(amount) =
                                                                            i128_val.get("lo")
                                                                        {
                                                                            // i128 as object: {"lo": 110000000}
                                                                            amount
                                                                                .as_u64()
                                                                                .unwrap_or(0)
                                                                        } else {
                                                                            0
                                                                        };

                                                                    if amount_val > 0 {
                                                                        ic_cdk::println!("Input Amount: {} XLM (raw: {})", amount_val as f64 / 10_000_000.0, amount_val);
                                                                          amount_to_send =
                                                                            amount_val as f64;
                                                                    } else {
                                                                        ic_cdk::println!("Could not parse in_amount. i128 structure: {:?}", i128_val);
                                                                    }
                                                                } else {
                                                                    ic_cdk::println!("Could not find i128 in in_amount. Full val structure: {:?}", item.get("val"));
                                                                }
                                                            }
                                                            "recipient_address" => {
                                                                if let Some(addr) = item
                                                                    .get("val")
                                                                    .and_then(|v| v.get("string"))
                                                                    .and_then(|s| s.as_str())
                                                                {
                                                                    ic_cdk::println!(
                                                                        "Destination Address: {}",
                                                                        addr
                                                                    );
                                                                    dest_address = addr.to_string();
                                                                }
                                                            }
                                                            _ => {}
                                                        }
                                                    }
                                                }

                                                // Send ETH if we have all required values
                                                if !dest_address.is_empty() && amount_to_send > 0.0
                                                {
                                                    ic_cdk::println!(
                                                        "Sending ETH to: {}",
                                                        dest_address
                                                    );
                                                    ic_cdk::println!("Amount: {}", amount_to_send);
                                                    ic_cdk::println!(
                                                        "Chain: {}",
                                                        destination_chain
                                                    );

                                                    let base_amount = match convert_xlm(amount_to_send/10_000_000.0).await {
                                                        Ok(amount) => {
                                                            ic_cdk::println!("✅ Successfully converted XLM to ETH amount: {}", amount);
                                                            amount
                                                        }
                                                        Err(e) => {
                                                            ic_cdk::println!("⚠️ XLM conversion failed: {}. Using fallback amount.", e);
                                                            // Use a reasonable fallback amount (0.001 ETH in wei)
                                                            10000000000000.0_f64

                                                        }
                                                    }; 

                                                    // Override for holesky testnet if needed
                                                    // let final_amount = if destination_chain == "holesky" {
                                                    //     ic_cdk::println!("🔧 Using hardcoded amount for holesky testnet");
                                                    //     1000000000.0_f64
                                                    // } else {
                                                    //     base_amount
                                                    // };

                                                    ic_cdk::println!("💰 Final amount to send: {} ETH", base_amount);

                                                    match send_eth_evm(
                                                        dest_address,
                                                        base_amount,
                                                        destination_chain.to_string(),
                                                    )
                                                    .await
                                                    {
                                                        Ok(tx_hash) => {
                                                            ic_cdk::println!("ETH transaction successful. TX Hash: {}", tx_hash);
                                                            result_summary.push_str(&tx_hash);
                                                        }
                                                        Err(e) => {
                                                            ic_cdk::println!(
                                                                "Error sending ETH: {}",
                                                                e
                                                            );
                                                            result_summary.push_str(&format!(
                                                                "Error sending ETH: {}\n",
                                                                e
                                                            ));
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    ic_cdk::println!(
                                        "🔍 No events found in ledger range {}-{} for contract {}",
                                        ledger,
                                        ledger + 5,
                                        contract_id
                                    );
                                    result_summary.push_str(&format!(
                                        "No events found for ledger range {}-{}\n",
                                        ledger,
                                        ledger + 5
                                    ));
                                }
                            }
                        }
                    }
                }
            }
            Ok(result_summary)
        }
        Err((code, msg)) => {
            let error_msg = format!("HTTP request failed: code = {:?}, message = {}", code, msg);
            ic_cdk::println!("{}", error_msg);
            Err(error_msg)
        }
    }
}

async fn convert_xlm(amount: f64) -> Result<f64, String> {
    ic_cdk::println!("🔄 Converting XLM amount: {} to ETH using hardcoded rate", amount);
    
    // Use hardcoded rate: 1 XLM = 0.000081 ETH
    let xlm_to_eth_rate = 0.000081;
    let value_in_eth = amount * xlm_to_eth_rate;
    
    ic_cdk::println!("💰 Using hardcoded rate: 1 XLM = 0.000081 ETH");
    ic_cdk::println!("🪙 ETH value: {} ETH", value_in_eth);

    Ok(value_in_eth)
}

/// Fetch USD price of a coin from CoinGecko
async fn fetch_price_usd(coin_id: &str) -> Result<f64, String> {
    let url = format!(
        "https://api.coingecko.com/api/v3/simple/price?ids={}&vs_currencies=usd",
        coin_id
    );

    let request = CanisterHttpRequestArgument {
        url,
        method: HttpMethod::GET,
        body: None,
        max_response_bytes: Some(2_000),
        transform: Some(TransformContext::from_name(
            "transform_coingecko_response".to_string(),
            vec![],
        )),
        headers: vec![HttpHeader {
            name: "Accept".to_string(),
            value: "application/json".to_string(),
        }],
    };

    // cycles payment (must be attached)
    let cycles = 2_000_000_000u128;

    let (response,): (HttpResponse,) = http_request(request, cycles)
        .await
        .map_err(|(_, err)| format!("http_request failed: {:?}", err))?;

    let body = String::from_utf8(response.body).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    v[coin_id]["usd"]
        .as_f64()
        .ok_or(format!("Failed to parse {} price", coin_id))
}

// Transform function to normalize CoinGecko API responses for consensus
#[ic_cdk::query]
fn transform_coingecko_response(raw: TransformArgs) -> HttpResponse {
    ic_cdk::println!("🔄 TRANSFORM: Processing CoinGecko response for consensus...");

    // Normalize headers to prevent consensus issues
    let normalized_headers = vec![
        HttpHeader {
            name: "Content-Type".to_string(),
            value: "application/json".to_string(),
        },
    ];

    // Process the response body
    let normalized_body = if let Ok(response_body) = String::from_utf8(raw.response.body.clone()) {
        ic_cdk::println!("📏 TRANSFORM: CoinGecko response length: {} bytes", response_body.len());
        
        // For CoinGecko, we just need to ensure the response is valid JSON
        // The response should be simple: {"stellar": {"usd": 0.10}}
        if let Ok(_json_value) = serde_json::from_str::<serde_json::Value>(&response_body) {
            ic_cdk::println!("✅ TRANSFORM: Valid JSON response from CoinGecko");
            raw.response.body.clone()
        } else {
            ic_cdk::println!("❌ TRANSFORM: Invalid JSON from CoinGecko, using original");
            raw.response.body.clone()
        }
    } else {
        ic_cdk::println!("❌ TRANSFORM: Invalid UTF-8 from CoinGecko, using original");
        raw.response.body.clone()
    };

    HttpResponse {
        status: raw.response.status.clone(),
        headers: normalized_headers,
        body: normalized_body,
    }
}

// Transform function to normalize Stellar RPC responses for consensus
// Based on ICP documentation: https://internetcomputer.org/docs/current/developer-docs/smart-contracts/advanced-features/https-outcalls/https-outcalls-get
#[ic_cdk::query]
fn transform_stellar_response(raw: TransformArgs) -> HttpResponse {
    ic_cdk::println!("🔄 TRANSFORM: Processing Stellar response for consensus...");

    // Step 1: Normalize headers to prevent consensus issues
    // Remove all dynamic headers that could vary between nodes
    let normalized_headers = vec![
        HttpHeader {
            name: "Content-Type".to_string(),
            value: "application/json".to_string(),
        },
        // Add only essential, stable headers - no dynamic ones like Date, Set-Cookie, etc.
    ];

    ic_cdk::println!(
        "🔧 TRANSFORM: Normalized headers from {} to {} entries",
        raw.response.headers.len(),
        normalized_headers.len()
    );

    // Step 2: Process the response body
    let normalized_body = if let Ok(response_body) = String::from_utf8(raw.response.body.clone()) {
        ic_cdk::println!(
            "📏 TRANSFORM: Original response length: {} bytes",
            response_body.len()
        );

        // Parse and normalize the JSON response body
        if let Ok(mut json_value) = serde_json::from_str::<serde_json::Value>(&response_body) {
            let mut removed_fields = Vec::new();

            // Remove dynamic fields that cause consensus issues
            if let Some(obj) = json_value.as_object_mut() {
                // Remove request ID that might vary
                if obj.remove("id").is_some() {
                    removed_fields.push("id");
                }

                if let Some(result) = obj.get_mut("result") {
                    if let Some(result_obj) = result.as_object_mut() {
                        // Remove latestLedger which changes frequently (every ~5 seconds)
                        if result_obj.remove("latestLedger").is_some() {
                            removed_fields.push("latestLedger");
                        }
                        // Remove pagination cursor which can vary
                        if result_obj.remove("cursor").is_some() {
                            removed_fields.push("cursor");
                        }
                        // Remove dynamic pagination links
                        if result_obj.remove("_links").is_some() {
                            removed_fields.push("_links");
                        }
                        // Remove any other potentially dynamic metadata
                        if result_obj.remove("_meta").is_some() {
                            removed_fields.push("_meta");
                        }
                    }
                }
            }

            ic_cdk::println!("🗑️ TRANSFORM: Removed dynamic fields: {:?}", removed_fields);

            // Serialize back to normalized JSON
            match serde_json::to_string(&json_value) {
                Ok(normalized) => {
                    ic_cdk::println!(
                        "✅ TRANSFORM: Normalized response length: {} bytes",
                        normalized.len()
                    );
                    normalized.into_bytes()
                }
                Err(_) => {
                    ic_cdk::println!(
                        "❌ TRANSFORM: Failed to serialize normalized JSON, using original"
                    );
                    raw.response.body.clone()
                }
            }
        } else {
            ic_cdk::println!("⚠️ TRANSFORM: Non-JSON response, using original body");
            raw.response.body.clone()
        }
    } else {
        ic_cdk::println!("❌ TRANSFORM: Invalid UTF-8 response, using original body");
        raw.response.body.clone()
    };

    // Step 3: Return normalized response
    let normalized_response = HttpResponse {
        status: raw.response.status.clone(),
        headers: normalized_headers, // ← KEY: Use normalized headers, not original ones
        body: normalized_body,
    };

    ic_cdk::println!("✅ TRANSFORM: Consensus-ready response prepared");
    normalized_response
}

// Query function to get stored events
#[ic_cdk::query]
fn get_events() -> Vec<CandidContractEvent> {
    EVENTS.with(|events| events.borrow().values().cloned().collect())
}

// Query function to get a specific event by ID
#[ic_cdk::query]
fn get_event_by_id(id: String) -> Option<CandidContractEvent> {
    EVENTS.with(|events| events.borrow().get(&id).cloned())
}
