import { Suspense } from "react";
import type { Metadata } from "next";
import { FundView } from "@/components/FundView";
import { Loading } from "@/components/Bits";

export const metadata: Metadata = { title: "Fund the pool" };

export default function Page() {
  return (
    <Suspense fallback={<div className="wrap page"><Loading label="Opening escrow" rows={4} /></div>}>
      <FundView />
    </Suspense>
  );
}
