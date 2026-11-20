import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 text-center">
      <h1 className="text-2xl font-bold">notifier</h1>
      <p className="text-fd-muted-foreground">
        Self-hosted push notifications for scripts, CI and servers.
      </p>
      <p>
        <Link href="/docs" className="font-medium underline">
          Read the docs
        </Link>
      </p>
    </div>
  );
}
