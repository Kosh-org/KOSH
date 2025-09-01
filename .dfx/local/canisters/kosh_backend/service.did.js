export const idlFactory = ({ IDL }) => {
  const Result = IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text });
  const CandidContractEvent = IDL.Record({
    'id' : IDL.Text,
    'topic' : IDL.Vec(IDL.Text),
    'contract_id' : IDL.Text,
    'ledger' : IDL.Nat32,
    'paging_token' : IDL.Text,
    'xdr_value' : IDL.Text,
  });
  const HttpHeader = IDL.Record({ 'value' : IDL.Text, 'name' : IDL.Text });
  const HttpResponse = IDL.Record({
    'status' : IDL.Nat,
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(HttpHeader),
  });
  const TransformArgs = IDL.Record({
    'context' : IDL.Vec(IDL.Nat8),
    'response' : HttpResponse,
  });
  return IDL.Service({
    'build_stellar_transaction' : IDL.Func(
        [IDL.Text, IDL.Text, IDL.Opt(IDL.Text)],
        [Result],
        [],
      ),
    'check_trustline' : IDL.Func(
        [IDL.Text, IDL.Text, IDL.Opt(IDL.Text)],
        [Result],
        [],
      ),
    'create_trustline' : IDL.Func(
        [IDL.Text, IDL.Text, IDL.Opt(IDL.Text), IDL.Opt(IDL.Text)],
        [Result],
        [],
      ),
    'evm_block_fetch' : IDL.Func([IDL.Nat64], [], []),
    'execute_bridge_lock' : IDL.Func(
        [IDL.Text, IDL.Text, IDL.Nat64, IDL.Text, IDL.Text, IDL.Opt(IDL.Text)],
        [Result],
        [],
      ),
    'execute_token_swap' : IDL.Func(
        [IDL.Text, IDL.Text, IDL.Text, IDL.Nat64, IDL.Text, IDL.Opt(IDL.Text)],
        [Result],
        [],
      ),
    'fetch_stellar_events' : IDL.Func([IDL.Nat32, IDL.Text], [Result], []),
    'generate_canister_key_pair_evm' : IDL.Func([], [Result], []),
    'generate_key_pair_evm' : IDL.Func([], [Result], []),
    'get_account_assets' : IDL.Func([IDL.Opt(IDL.Text)], [Result], []),
    'get_event_by_id' : IDL.Func(
        [IDL.Text],
        [IDL.Opt(CandidContractEvent)],
        ['query'],
      ),
    'get_events' : IDL.Func([], [IDL.Vec(CandidContractEvent)], ['query']),
    'greet' : IDL.Func([IDL.Text], [IDL.Text], ['query']),
    'public_key_stellar' : IDL.Func([], [Result], []),
    'send_eth_evm' : IDL.Func([IDL.Text, IDL.Float64, IDL.Text], [Result], []),
    'sign_stellar_swap' : IDL.Func([IDL.Text, IDL.Opt(IDL.Text)], [Result], []),
    'start_periodic_fetch' : IDL.Func([IDL.Nat64], [], []),
    'stellar_user_lock_txn' : IDL.Func([IDL.Text, IDL.Text], [Result], []),
    'transform_coingecko_response' : IDL.Func(
        [TransformArgs],
        [HttpResponse],
        ['query'],
      ),
    'transform_http_response' : IDL.Func(
        [TransformArgs],
        [HttpResponse],
        ['query'],
      ),
    'transform_stellar_response' : IDL.Func(
        [TransformArgs],
        [HttpResponse],
        ['query'],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
