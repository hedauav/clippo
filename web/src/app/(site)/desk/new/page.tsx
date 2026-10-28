import type { Metadata } from "next";
import { Wizard } from "@/components/Wizard";
import { PageHead } from "@/components/Bits";

export const metadata: Metadata = { title: "New campaign" };

export default function Page() {
  return (
    <div className="wrap page">
      <PageHead kicker={<><span>Desk</span><span>New campaign</span></>} title={<>One question at a <em>time</em></>}>
        Nothing is charged until the last step. You can go back and change any answer.
      </PageHead>
      <Wizard />
    </div>
  );
}
