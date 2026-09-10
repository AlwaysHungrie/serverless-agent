import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-16">
      <SignIn />
    </div>
  );
}
