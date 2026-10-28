import Link from "next/link";
import { Stamp } from "@/components/Stamp";
import { Arrow } from "@/components/Icons";
import { PoolTicker } from "./PoolTicker";
import { ClipBand } from "./ClipBand";
import "./hero.css";
import "./clipband.css";

/* Sample content only. The figure is labelled as sample on the page. */
export function Hero() {
  return (
    <section className="hx" aria-labelledby="hx-h">
      <div className="hx-kicker micro">
        <span>The Clipping Desk</span>
        <span className="hx-k-mid">Brands fund. Humans clip. An agent reads. Chain pays.</span>
        <span>Sample ledger</span>
      </div>

      <h1 id="hx-h" className="display hx-h">
        Clips get read
        <br />
        before they get <em className="signal">paid.</em>
      </h1>

      <div className="hx-body">
        <div className="hx-copy">
          <p className="lead">
            A brand puts USDC in a pool. Verified humans cut clips and post them. An agent checks every one against the brand&rsquo;s story, stamps it, and
            writes the reason in the margin. Approved views settle on-chain. Rejected creators see exactly why.
          </p>
          <div className="hx-cta">
            <Link href="/desk/new" className="btn">
              Start a campaign <Arrow size={18} />
            </Link>
            <Link href="/wire" className="btn ghost">
              Browse the wire
            </Link>
          </div>
          <p className="micro hx-fine">Fee 0.1 to 0.5 per side, taken by the escrow. A person approves every campaign before a creator can join.</p>
        </div>

        <figure className="hx-desk" aria-label="Sample: one bounty, two clips, one payout">
          <div className="hx-slip">
            <div className="hx-slip-main">
              <span className="micro">Bounty No. 0042 · Ledgerlane</span>
              <span className="hx-slip-t display">Explain the 3-minute close</span>
              <span className="micro">Pool remaining, USDC</span>
              <span className="hx-pool fig">
                <PoolTicker from={1816.2} to={1740} />
              </span>
            </div>
            <div className="hx-slip-stub micro" aria-hidden="true">
              <span>$2.40</span>
              <span>per 1,000</span>
            </div>
          </div>

          <div className="hx-entry hx-e1">
            <div className="hx-e-head">
              <span className="fig">02 · @duskpilot</span>
              <span className="micro">youtube</span>
            </div>
            <p className="hx-quote">&ldquo;Watch a real month-end close, start to finish, in three minutes.&rdquo;</p>
            <div className="hx-stampbox">
              <Stamp verdict="approved" conf={0.94} />
            </div>
            <p className="hx-margin">On brief. Both required points said. #ad label at 0:02.</p>
          </div>

          <div className="hx-pay fig">
            <span>@duskpilot</span>
            <span className="hx-dots" aria-hidden="true" />
            <span className="hx-amt">+76.20 USDC</span>
            <span className="hx-settled micro">settled</span>
          </div>

          <div className="hx-entry hx-e2">
            <div className="hx-e-head">
              <span className="fig">03 · @numbers.nina</span>
              <span className="micro">x</span>
            </div>
            <p className="hx-quote">
              &ldquo;It&rsquo;s <mark>guaranteed to save 20 hours</mark> a week.&rdquo;
            </p>
            <div className="hx-stampbox">
              <Stamp verdict="rejected" conf={0.88} />
            </div>
            <p className="hx-margin">Guaranteed savings are on the prohibited list. No disclosure label found. Creator sees this, and can appeal.</p>
          </div>

          <figcaption className="micro hx-cap">Sample data, not live. Rejected clips are never paid.</figcaption>
        </figure>
      </div>

      <ClipBand />
    </section>
  );
}
