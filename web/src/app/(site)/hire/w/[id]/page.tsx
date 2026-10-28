import { Suspense } from "react";
import type { Metadata } from "next";
import { WorkspaceView } from "@/components/workspace/WorkspaceView";
import { Loading } from "@/components/Bits";

export const metadata: Metadata = { title: "Creator workspace" };

export default function Page() {
  return (
    <Suspense fallback={<div className="wrap page"><Loading label="Opening the workspace" rows={5} /></div>}>
      <WorkspaceView />
    </Suspense>
  );
}
