import { Suspense } from "react";
import { SlipDetail } from "@/components/SlipDetail";
import { Loading } from "@/components/Bits";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="wrap page">
          <Loading label="Pulling the slip" rows={6} />
        </div>
      }
    >
      <SlipDetail />
    </Suspense>
  );
}
