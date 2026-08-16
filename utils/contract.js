export const CONTRACT_ADDRESS = "0x0364D7EE5edD505d930C19349A2581A3792d8162";

export const CONTRACT_ABI = [
  "function create_market(string question, string sources_json, uint16 duration_days, uint16 fee_bps) returns (uint256)",
  "function bet(uint256 market_id, bool is_yes) payable",
  "function resolve_market(uint256 market_id)",
  "function claim(uint256 market_id)",
  "function get_market(uint256 market_id) view returns (string)",
  "function get_bet(uint256 market_id, string user, bool is_yes) view returns (string)"
];
