import type { Metadata } from "next";
import { JoinView } from "@/components/JoinView";

export const metadata: Metadata = { title: "Join" };

export default function Page() {
  return <JoinView />;
}
