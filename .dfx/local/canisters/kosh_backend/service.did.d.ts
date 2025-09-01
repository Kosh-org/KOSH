import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface CandidContractEvent {
  'id' : string,
  'topic' : Array<string>,
  'contract_id' : string,
  'ledger' : number,
  'paging_token' : string,
  'xdr_value' : string,
}
export interface HttpHeader { 'value' : string, 'name' : string }
export interface HttpResponse {
  'status' : bigint,
  'body' : Uint8Array | number[],
  'headers' : Array<HttpHeader>,
}
export type Result = { 'Ok' : string } |
  { 'Err' : string };
export interface TransformArgs {
  'context' : Uint8Array | number[],
  'response' : HttpResponse,
}
export interface _SERVICE {
  'build_stellar_transaction' : ActorMethod<
    [string, string, [] | [string]],
    Result
  >,
  'check_trustline' : ActorMethod<[string, string, [] | [string]], Result>,
  'create_trustline' : ActorMethod<
    [string, string, [] | [string], [] | [string]],
    Result
  >,
  'evm_block_fetch' : ActorMethod<[bigint], undefined>,
  'execute_bridge_lock' : ActorMethod<
    [string, string, bigint, string, string, [] | [string]],
    Result
  >,
  'execute_token_swap' : ActorMethod<
    [string, string, string, bigint, string, [] | [string]],
    Result
  >,
  'fetch_stellar_events' : ActorMethod<[number, string], Result>,
  'generate_canister_key_pair_evm' : ActorMethod<[], Result>,
  'generate_key_pair_evm' : ActorMethod<[], Result>,
  'get_account_assets' : ActorMethod<[[] | [string]], Result>,
  'get_event_by_id' : ActorMethod<[string], [] | [CandidContractEvent]>,
  'get_events' : ActorMethod<[], Array<CandidContractEvent>>,
  'greet' : ActorMethod<[string], string>,
  'public_key_stellar' : ActorMethod<[], Result>,
  'send_eth_evm' : ActorMethod<[string, number, string], Result>,
  'sign_stellar_swap' : ActorMethod<[string, [] | [string]], Result>,
  'start_periodic_fetch' : ActorMethod<[bigint], undefined>,
  'stellar_user_lock_txn' : ActorMethod<[string, string], Result>,
  'transform_coingecko_response' : ActorMethod<[TransformArgs], HttpResponse>,
  'transform_http_response' : ActorMethod<[TransformArgs], HttpResponse>,
  'transform_stellar_response' : ActorMethod<[TransformArgs], HttpResponse>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
