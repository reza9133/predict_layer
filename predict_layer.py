# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import re
import typing

def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())

def _sanitize_page(raw: typing.Any) -> str:
    if not isinstance(raw, str):
        return ""
    t = re.sub(r"<\s*/?\s*UNTRUSTED(?:\s+[^>]*)?\s*>", "", raw, flags=re.IGNORECASE)
    # Limit size to prevent LLM token overflow
    return " ".join(t.strip().split())[:8000]

def _resolve_nondet(question: str, sources_json: str) -> str:
    sources = json.loads(sources_json)
    yes_votes = 0
    no_votes = 0
    
    for url in sources:
        try:
            res = gl.nondet.web.get(url)
            raw = res.body.decode("utf-8", errors="replace") if res.body else ""
            page = _sanitize_page(raw)
            
            prompt = f"""You are a strict prediction market resolution oracle.
Market Question: "{question}"

Source webpage text:
<UNTRUSTED>
{page}
</UNTRUSTED>

Based ONLY on the text above, has the event definitively occurred or is the answer unequivocally YES or NO?
If the event hasn't happened yet, or the source doesn't contain clear proof, answer UNRESOLVED.

Return exactly one JSON object:
{{"decision": "YES" or "NO" or "UNRESOLVED"}}"""
            
            res_llm = gl.nondet.exec_prompt(prompt, response_format="json")
            decision = str(res_llm.get("decision", "UNRESOLVED")).upper()
            
            if decision == "YES":
                yes_votes += 1
            elif decision == "NO":
                no_votes += 1
        except Exception:
            pass
            
    total_sources = len(sources)
    if yes_votes > total_sources / 2:
        return "YES"
    elif no_votes > total_sources / 2:
        return "NO"
    else:
        return "UNRESOLVED"

@gl.evm.contract_interface
class _Payee:
    class View: pass
    class Write: pass

@allow_storage
@dataclass
class Market:
    creator: Address
    question: str
    sources_json: str
    deadline_at: u64
    pool_yes: u256
    pool_no: u256
    creator_fee_bps: u16 # Basis points (e.g., 200 = 2%)
    state: str # OPEN, RESOLVED, CANCELLED
    outcome: str # NONE, YES, NO, UNRESOLVED

class PredictLayer(gl.Contract):
    markets: TreeMap[u256, Market]
    bets: TreeMap[str, u256]
    next_market_id: u256

    def __init__(self):
        self.next_market_id = u256(1)

    @gl.public.write
    def create_market(self, question: str, sources_json: str, duration_days: u16, fee_bps: u16) -> int:
        if len(question.strip()) < 10:
            raise gl.vm.UserError("Question too short")
            
        if fee_bps > 1000:
            raise gl.vm.UserError("Max creator fee is 10% (1000 bps)")

        sources = json.loads(sources_json)
        if not isinstance(sources, list) or len(sources) < 1 or len(sources) > 5:
            raise gl.vm.UserError("Provide 1 to 5 HTTPS sources")
            
        for url in sources:
            if not str(url).startswith("https://"):
                raise gl.vm.UserError("Sources must be secure HTTPS URLs")
                
        now = _now()
        if now == 0:
            raise gl.vm.UserError("Time data missing (fail closed)")
            
        deadline = now + int(duration_days) * 86400
        mid = self.next_market_id
        self.next_market_id = self.next_market_id + u256(1)
        
        self.markets[mid] = Market(
            creator=gl.message.sender_address,
            question=question,
            sources_json=json.dumps(sources),
            deadline_at=u64(deadline),
            pool_yes=u256(0),
            pool_no=u256(0),
            creator_fee_bps=fee_bps,
            state="OPEN",
            outcome="NONE"
        )
        return int(mid)

    @gl.public.write.payable
    def bet(self, market_id: int, is_yes: bool):
        mid = u256(market_id)
        if mid not in self.markets:
            raise gl.vm.UserError("Market not found")
            
        m = self.markets[mid]
        if m.state != "OPEN":
            raise gl.vm.UserError("Market is not open")
            
        now = _now()
        if now == 0 or now >= int(m.deadline_at):
            raise gl.vm.UserError("Market deadline passed or time missing")
            
        val = gl.message.value
        if val == u256(0):
            raise gl.vm.UserError("Must bet greater than 0")
            
        caller = str(gl.message.sender_address).lower()
        side = "YES" if is_yes else "NO"
        bet_key = f"{int(mid)}:{caller}:{side}"
        
        current_bet = self.bets[bet_key] if bet_key in self.bets else u256(0)
        self.bets[bet_key] = current_bet + val
        
        if is_yes:
            m.pool_yes = m.pool_yes + val
        else:
            m.pool_no = m.pool_no + val

    @gl.public.write
    def resolve_market(self, market_id: int):
        mid = u256(market_id)
        if mid not in self.markets:
            raise gl.vm.UserError("Market not found")
            
        m = self.markets[mid]
        if m.state != "OPEN":
            raise gl.vm.UserError("Market already resolved")
            
        now = _now()
        if now == 0 or now < int(m.deadline_at):
            raise gl.vm.UserError("Market deadline not yet reached (fail closed)")
            
        q = str(m.question)
        s_json = str(m.sources_json)

        def leader_fn() -> str:
            return _resolve_nondet(q, s_json)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                leader_str = str(leader_result.calldata)
                my_str = _resolve_nondet(q, s_json)
                return my_str == leader_str
            except Exception:
                return False

        outcome = str(gl.vm.run_nondet_unsafe(leader_fn, validator_fn))
        
        if outcome in ("YES", "NO"):
            m.outcome = outcome
            m.state = "RESOLVED"
        elif outcome == "UNRESOLVED":
            m.outcome = "UNRESOLVED"
            m.state = "CANCELLED"
        else:
            raise gl.vm.UserError("Consensus failed or invalid outcome")

    @gl.public.write
    def claim(self, market_id: int):
        mid = u256(market_id)
        if mid not in self.markets:
            raise gl.vm.UserError("Market not found")
            
        m = self.markets[mid]
        caller_addr = gl.message.sender_address
        caller = str(caller_addr).lower()
        
        # Refund logic if market is cancelled (UNRESOLVED)
        if m.state == "CANCELLED":
            bet_yes_key = f"{int(mid)}:{caller}:YES"
            bet_no_key = f"{int(mid)}:{caller}:NO"
            
            my_yes_bet = self.bets[bet_yes_key] if bet_yes_key in self.bets else u256(0)
            my_no_bet = self.bets[bet_no_key] if bet_no_key in self.bets else u256(0)
            total_refund = my_yes_bet + my_no_bet
            
            if total_refund == u256(0):
                raise gl.vm.UserError("No bets to refund")
                
            self.bets[bet_yes_key] = u256(0)
            self.bets[bet_no_key] = u256(0)
            
            _Payee(caller_addr).emit_transfer(value=total_refund)
            return

        if m.state != "RESOLVED":
            raise gl.vm.UserError("Market is not resolved yet")
            
        if m.outcome == "YES":
            winning_pool = m.pool_yes
            losing_pool = m.pool_no
            my_bet_key = f"{int(mid)}:{caller}:YES"
        elif m.outcome == "NO":
            winning_pool = m.pool_no
            losing_pool = m.pool_yes
            my_bet_key = f"{int(mid)}:{caller}:NO"
        else:
            raise gl.vm.UserError("Invalid outcome state")
            
        my_bet = self.bets[my_bet_key] if my_bet_key in self.bets else u256(0)
        if my_bet == u256(0):
            raise gl.vm.UserError("No winning bet to claim")
            
        total_pool = winning_pool + losing_pool
        
        # Calculate fee
        fee_amount = u256((int(total_pool) * int(m.creator_fee_bps)) // 10000)
        net_pool = total_pool - fee_amount
        
        # Calculate user payout
        payout = u256((int(my_bet) * int(net_pool)) // int(winning_pool))
        
        # Checks-Effects-Interactions
        self.bets[my_bet_key] = u256(0)
        
        # Pay creator fee (only once, triggered by the first claimer to simplify logic, 
        # or distributed proportionally. Here we leave the fee in the contract for the creator to pull, 
        # but for simplicity in this primitive, we route payout direct to user).
        # A full prod version would have a separate pull mechanism for creator fees.
        
        _Payee(caller_addr).emit_transfer(value=payout)

    @gl.public.view
    def get_market(self, market_id: int) -> str:
        mid = u256(market_id)
        if mid not in self.markets:
            return "{}"
        m = self.markets[mid]
        return json.dumps({
            "creator": str(m.creator),
            "question": m.question,
            "sources_json": m.sources_json,
            "deadline_at": int(m.deadline_at),
            "pool_yes": str(m.pool_yes),
            "pool_no": str(m.pool_no),
            "fee_bps": int(m.creator_fee_bps),
            "state": m.state,
            "outcome": m.outcome
        })
        
    @gl.public.view
    def get_bet(self, market_id: int, user: str, is_yes: bool) -> str:
        side = "YES" if is_yes else "NO"
        key = f"{market_id}:{user.lower()}:{side}"
        val = self.bets[key] if key in self.bets else u256(0)
        return str(val)
