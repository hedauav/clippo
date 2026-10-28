import { Suspense } from "react";
import type { Metadata } from "next";
import { SharedView } from "@/components/workspace/SharedView";
import { Loading } from "@/components/Bits";

export const metadata: Metadata = { title: "Shared campaign view" };

export default function Page() {
  return (
    <Suspense fallback={<div className="wrap page"><Loading label="Pulling the shared copy" rows={5} /></div>}>
      <SharedView />
    </Suspense>
  );
}
