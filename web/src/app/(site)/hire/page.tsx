import type { Metadata } from "next";
import { Directory } from "@/components/workspace/Directory";

export const metadata: Metadata = { title: "Hire creators" };

export default function Page() {
  return <Directory />;
}
