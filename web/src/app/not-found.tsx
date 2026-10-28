import Link from "next/link";
import { Empty, PageHead } from "@/components/Bits";

/** Themed 404 (also what disabled optional modules answer): stays inside the Paper/Night shell instead of Next's white default. */
export default function NotFound() {
  return (
    <div className="wrap page">
      <PageHead kicker="No. 404" title={<>Not on <em>file</em></>}>
        There is no page at this address.
      </PageHead>
      <Empty title="Nothing here." action={<Link href="/wire" className="btn sm">Browse the wire</Link>}>
        The link may be cut short, or this part of Clippo is switched off in this build.
      </Empty>
    </div>
  );
}
