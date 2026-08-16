# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import re
import typing

# Pagination safety limits for get_all_markets(). Capping these server-side
# means a malicious or buggy frontend can never force an unbounded loop or
# an oversized calldata response, regardless of what it passes in.
MAX_PAGE_SIZE = 50
DEFAULT_PAGE_SIZE = 20


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
    class View:
        pass

    class Write:
        pass


@allow_storage
@dataclass
class Market:
    creator: Address
    question: str
    sources_json: str
    deadline_at: u64
    pool_yes: u256
    pool_no: u256
    creator_fee_bps: u16  # Basis points (e.g., 200 = 2%)
    state: str  # OPEN, RESOLVED, CANCELLED
    outcome: str  # NONE, YES, NO, UNRESOLVED


def _market_to_dict(market_id: int, m: Market) -> dict:
    """
    Single source of truth for how a Market is shaped into JSON.
    Used by both get_market() and get_all_markets() so the two endpoints
    can never drift into returning different field sets for the same data.
    """
    return {
        "id": market_id,
        "creator": str(m.creator),
        "question": m.question,
        "sources_json": m.sources_json,
        "deadline_at": int(m.deadline_at),
        "pool_yes": str(m.pool_yes),
        "pool_no": str(m.pool_no),
        "fee_bps": int(m.creator_fee_bps),
        "state": m.state,
        "outcome": m.outcome,
    }


class PredictLayer(gl.Contract):
    markets: TreeMap[u256, Market]
    bets: TreeMap[str, u256]
    next_market_id: u256

    def __init__(self):
        self.next_market_id = u256(1)

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

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
            outcome="NONE",
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

        # NOTE: as in the original contract, fee_amount is deducted from the
        # payout pool but not routed anywhere claimable by the creator. See
        # the message accompanying this file for details.
        _Payee(caller_addr).emit_transfer(value=payout)

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @gl.public.view
    def get_market(self, market_id: int) -> str:
        mid = u256(market_id)
        if mid not in self.markets:
            return "{}"
        m = self.markets[mid]
        return json.dumps(_market_to_dict(market_id, m))

    @gl.public.view
    def get_bet(self, market_id: int, user: str, is_yes: bool) -> str:
        side = "YES" if is_yes else "NO"
        key = f"{market_id}:{user.lower()}:{side}"
        val = self.bets[key] if key in self.bets else u256(0)
        return str(val)

    @gl.public.view
    def get_market_count(self) -> int:
        """
        Total number of markets ever created.

        next_market_id is incremented exactly once per create_market call and
        IDs are never reused (markets are never deleted), so it is already a
        reliable, gas-free source of truth for the count. A separate counter
        would just be redundant storage that has to be kept in sync on every
        write for no benefit.
        """
        return int(self.next_market_id) - 1

    @gl.public.view
    def get_all_markets(self, offset: int, limit: int) -> str:
        """
        Paginated market listing so the frontend can render market cards on
        load without the user typing a market_id.

        Returns a JSON string:
        {"total": int, "offset": int, "limit": int, "markets": [ ... ]}

        Iterates the known, contiguous ID range [1 .. next_market_id-1]
        rather than the TreeMap's own iteration order, so correctness does
        not depend on any undocumented ordering behavior of TreeMap - only
        on the fact that create_market assigns IDs sequentially. offset and
        limit are clamped server-side, so no combination of inputs can
        trigger an unbounded loop or an oversized response.
        """
        total = int(self.next_market_id) - 1

        safe_offset = offset if offset > 0 else 0

        if limit <= 0:
            safe_limit = DEFAULT_PAGE_SIZE
        elif limit > MAX_PAGE_SIZE:
            safe_limit = MAX_PAGE_SIZE
        else:
            safe_limit = limit

        results = []
        if safe_offset < total:
            start_id = safe_offset + 1
            end_id = min(start_id + safe_limit - 1, total)
            for market_id in range(start_id, end_id + 1):
                mid = u256(market_id)
                if mid in self.markets:
                    results.append(_market_to_dict(market_id, self.markets[mid]))

        return json.dumps({
            "total": total,
            "offset": safe_offset,
            "limit": safe_limit,
            "markets": results,
        })
