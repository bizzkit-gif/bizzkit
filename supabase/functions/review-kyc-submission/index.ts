import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

type KycSubmissionRow = {
  id: string;
  business_id: string;
  owner_name: string;
  company_registration_no: string;
  country: string;
  document_url: string;
  status: "pending" | "approved" | "rejected";
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function tier(score: number): string {
  if (score >= 90) return "Platinum";
  if (score >= 75) return "Gold";
  if (score >= 50) return "Silver";
  return "Bronze";
}

function reviewSubmission(input: KycSubmissionRow): { status: "approved" | "rejected"; reason: string } {
  let score = 0;
  if (input.owner_name.trim().length >= 5) score += 20;
  if (input.company_registration_no.trim().length >= 5) score += 20;
  if (input.country.trim().length >= 2) score += 10;
  if (input.document_url.startsWith("http")) score += 30;
  if (
    input.document_url.includes(".pdf") ||
    input.document_url.includes(".png") ||
    input.document_url.includes(".jpg") ||
    input.document_url.includes(".jpeg") ||
    input.document_url.includes(".webp")
  ) {
    score += 20;
  }

  if (score >= 70) return { status: "approved", reason: "Submission looks complete and document format is valid." };
  return { status: "rejected", reason: "Submission is incomplete or document evidence appears insufficient." };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Missing service credentials" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const submissionId = typeof body?.submissionId === "string" ? body.submissionId : "";
    if (!submissionId) {
      return new Response(JSON.stringify({ error: "submissionId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: submission, error: submissionErr } = await admin
      .from("kyc_submissions")
      .select("*")
      .eq("id", submissionId)
      .single<KycSubmissionRow>();

    if (submissionErr || !submission) {
      return new Response(JSON.stringify({ error: submissionErr?.message || "Submission not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = reviewSubmission(submission);
    const { error: updateErr } = await admin
      .from("kyc_submissions")
      .update({
        status: result.status,
        decision_reason: result.reason,
        reviewed_by: "ai-agent",
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", submission.id);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (result.status === "approved") {
      const { data: biz } = await admin
        .from("businesses")
        .select("trust_score")
        .eq("id", submission.business_id)
        .single<{ trust_score: number }>();
      const nextScore = Math.min(100, (biz?.trust_score || 0) + 15);
      await admin
        .from("businesses")
        .update({ kyc_verified: true, trust_score: nextScore, trust_tier: tier(nextScore) })
        .eq("id", submission.business_id);
    }

    return new Response(JSON.stringify({ id: submission.id, status: result.status, reason: result.reason }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
