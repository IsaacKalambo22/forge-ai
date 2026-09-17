import { PageHeader } from "@/components/ui";

import Ask from "./ask";
import Chat from "./chat";

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Notebook"
        description="Chat with Claude, or ask a question answered from the local corpus."
      />
      <Chat />
      <Ask />
    </div>
  );
}
