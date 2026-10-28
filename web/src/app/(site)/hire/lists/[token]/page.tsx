import { Suspense } from "react";
import type { Metadata } from "next";
import { ListView } from "@/components/workspace/ListView";
import { Loading } from "@/components/Bits";

export const metadata: Metadata = { title: "Shortlist" };

export default function Page() {
  return (
    <Suspense fallback={<div className="wrap page"><Loading label="Pulling the list" rows={5} /></div>}>
      <ListView />
    </Suspense>
  );
}
