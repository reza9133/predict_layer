export const CONTRACT_ADDRESS = "0x6823Aed36A72fBE98179D0366A562aF8E9a00FaC";

export const CONTRACT_ABI = [
  "function create_market(string question, string sources_json, uint16 duration_days, uint16 fee_bps) returns (uint256)",
  "function bet(uint256 market_id, bool is_yes) payable",
  "function resolve_market(uint256 market_id)",
  "function claim(uint256 market_id)",
  "function get_market(uint256 market_id) view returns (string)",
  "function get_bet(uint256 market_id, string user, bool is_yes) view returns (string)"
];
