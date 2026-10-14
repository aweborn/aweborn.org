"""Illustrative simulation of the universal mana pool (Phase 05, draft model v1).

Regenerate the chart:
    python3 phases/assets/mana_pool_chart.py          # tau = 30 days -> mana-pool-model.png
    python3 phases/assets/mana_pool_chart.py 90       # comparison     -> mana-pool-model-tau90.png

Model (see phases/05-mana-economy.md -> "The Mana Pool Formula"):
    inflow_t   = K * ALPHA * net_donations_t            (linear in money)
    cap_t      = max(pool_t / TAU, P_SOLO)              (global flow per day; never below one player's cap)
    drawn_t    = min(demand_t, cap_t, pool_t + inflow_t) (requests above this are "whispered")
    (The per-player max-min fair split of cap_t among active players is not simulated here.)
    pool_t+1   = pool_t + inflow_t - drawn_t
    highwater  = cumulative mana ever donated + awe reach (never falls)

All numbers are made up to show the shape, not forecasts.
"""

import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

K = 100  # mana per compute-dollar (1 mana = $0.01 of real compute)
ALPHA = 0.5  # creative share: half of each net gift becomes mana (rest: research, ops, fundraising)
TAU = int(sys.argv[1]) if len(sys.argv) > 1 else 30  # days: pool shrinks by at most 1/TAU of itself per day
P_SOLO = 300  # mana/day: one level-1 player's personal cap (placeholder until Phase 07 costs)
DAYS = 120

rng = np.random.default_rng(7)
days = np.arange(DAYS)

# Donations ($/day): small steady gifts + a few big moments + a dry spell.
donations = rng.gamma(2.0, 10.0, DAYS)  # ~ $20/day of small gifts
donations[20] += 500  # a $500 gift
donations[45] += 800  # card event / fundraiser
donations[60:90] *= 0.05  # dry spell
donations[100] += 600

# Demand (mana/day players *want* to manifest): grows with the community, weekend bumps.
players = 20 + days * 0.6
demand = players * rng.gamma(4.0, 6.25, DAYS) * (1 + 0.3 * (days % 7 >= 5))  # ~25 mana ($0.25)/player/day

pool = np.zeros(DAYS + 1)
pool[0] = 20_000  # seed grant ($200 of compute)
inflow = K * ALPHA * donations
drawn = np.zeros(DAYS)
cap = np.zeros(DAYS)
for t in days:
    cap[t] = min(max(pool[t] / TAU, P_SOLO), pool[t] + inflow[t])
    drawn[t] = min(demand[t], cap[t], pool[t] + inflow[t])
    pool[t + 1] = pool[t] + inflow[t] - drawn[t]

awe_reach = np.cumsum(rng.poisson(1.0, DAYS) * 30)  # awe raises the high-water line, not the pool
highwater = pool[0] + np.cumsum(inflow) + awe_reach

# ---- plot ----
plt.rcParams.update({"font.family": "sans-serif", "font.size": 10})
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 7.5), sharex=True, gridspec_kw={"height_ratios": [3, 2]})
fig.patch.set_facecolor("#0b0d1a")
for ax in (ax1, ax2):
    ax.set_facecolor("#11142a")
    ax.tick_params(colors="#c9cbe0")
    for s in ax.spines.values():
        s.set_color("#33375a")
    ax.grid(color="#262a4a", linewidth=0.6)

gold, violet, teal, rose = "#f5c451", "#9b8cff", "#5fd4c4", "#ff7a90"

ax1.fill_between(days, pool[:-1], color=gold, alpha=0.18)
ax1.plot(days, pool[:-1], color=gold, lw=2.2, label="Universal mana pool (spendable now)")
ax1.plot(days, highwater, color=violet, lw=1.6, ls="--", label="High-water line (sets the Frontier, never falls)")
whisper = demand > drawn + 1
ax1.scatter(days[whisper], np.full(whisper.sum(), 0), color=rose, s=10, zorder=5,
            label='Requests throttled ("the world must be replenished…")')
for d, txt in [(20, "$500 gift"), (45, "card event"), (75, "dry spell: pool drains"), (100, "$600 gift")]:
    ax1.annotate(txt, (d, pool[d + 1]), xytext=(0, 18), textcoords="offset points",
                 ha="center", color="#e6e7f5", fontsize=9,
                 arrowprops=dict(arrowstyle="-", color="#6b6f99"))
ax1.set_ylabel("mana", color="#c9cbe0")
ax1.set_title("Universal mana pool: money in fills it, manifesting drains it",
              color="#f2f3ff", fontsize=13, loc="left")
ax1.legend(facecolor="#161a35", edgecolor="#33375a", labelcolor="#e6e7f5", fontsize=8.5, loc="upper left")

ax2.bar(days, inflow, color=teal, alpha=0.75, label="Inflow = K x alpha x donations")
ax2.bar(days, -drawn, color=gold, alpha=0.75, label="Drawn by manifesting")
ax2.plot(days, -demand, color=rose, lw=1, alpha=0.9, label="Demand (what players asked for)")
ax2.plot(days, -cap, color=violet, lw=1.2, ls=":", label="Global flow = max(pool / tau, one player's cap)")
LIM = 4_500
ax2.set_ylim(-LIM, LIM)
for d in days[inflow > LIM]:
    ax2.annotate(f"+{inflow[d] / 1000:.1f}k", (d, LIM), xytext=(0, -10), textcoords="offset points",
                 ha="center", color=teal, fontsize=8)
ax2.set_ylabel("mana / day", color="#c9cbe0")
ax2.set_xlabel("day", color="#c9cbe0")
ax2.legend(facecolor="#161a35", edgecolor="#33375a", labelcolor="#e6e7f5", fontsize=8, loc="lower left", ncol=2)

fig.text(0.01, 0.005, f"Illustrative only. K={K} mana per compute-$ (1 mana = 1 cent), alpha={ALPHA}, tau={TAU} days, solo cap={P_SOLO} mana/day.",
         color="#8a8db3", fontsize=8)
fig.tight_layout(rect=(0, 0.02, 1, 1))
out = Path(__file__).with_name("mana-pool-model.png" if TAU == 30 else f"mana-pool-model-tau{TAU}.png")
fig.savefig(out, dpi=150, facecolor=fig.get_facecolor())
print(f"wrote {out}")
