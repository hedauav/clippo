import type { Metadata } from "next";
import { ReferralView } from "@/components/ModulePages";

export const metadata: Metadata = { title: "Referrals" };

export default function Page() {
  return <ReferralView />;
}
