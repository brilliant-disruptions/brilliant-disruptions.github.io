import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/TopBar";
import { ToastProvider } from "@/components/Toast";
import { CommandBar } from "@/components/CommandBar";

// The real admin-only gate (spec §9): a signed-in user must have an active
// `members` row. RLS would already hide all data from non-members, but we
// reject them explicitly here so they never see an empty shell.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("handle, full_name, avatar_color, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!member || !member.is_active) {
    await supabase.auth.signOut();
    redirect("/login?denied=1");
  }

  const { data: builds } = await supabase
    .from("builds")
    .select("id, name, slug, color, stage, health_score")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const { data: briefing } = await supabase
    .from("briefings")
    .select("headline")
    .in("kind", ["daily", "alert"])
    .order("generated_for", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <ToastProvider>
      <div className="min-h-screen">
        <TopBar
          member={member}
          builds={builds ?? []}
          pulse={briefing?.headline ?? null}
        />
        <main className="mx-auto max-w-[1600px] px-4 py-6 pb-28 sm:px-6">{children}</main>
        <CommandBar />
      </div>
    </ToastProvider>
  );
}
