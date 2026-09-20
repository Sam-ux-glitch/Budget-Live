import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Browser CORS preflight must be answered BEFORE authentication
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const {error:rulesError}=await userClient.rpc("apply_transaction_rules",{target_user_id:user.id});
    if(rulesError)throw new Error("Transaction rules unavailable");

    const { data: categories, error: categoryError } = await admin
      .from("budget_categories")
      .select("id,name")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (categoryError) throw categoryError;

    if (!categories?.length) {
      throw new Error("No active budget categories found.");
    }

    const categoryNames = categories.map((category) => category.name);

    const { data: transactions, error: transactionError } = await admin
      .from("transactions")
      .select(
        "id,merchant_name,description,amount,plaid_category_primary,plaid_category_detailed"
      )
      .eq("user_id", user.id)
      .is("category_id", null)
      .eq("excluded_from_budget", false)
      .eq("user_category_confirmed", false)
      .eq("is_transfer",false)
      .is("plaid_removed_at",null)
      .eq("ai_status", "pending")
      .limit(25);

    if (transactionError) throw transactionError;

    if (!transactions?.length) {
      return Response.json(
        { success: true, processed: 0 },
        { headers: corsHeaders }
      );
    }

    let processed = 0;

    for (const transaction of transactions) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          store:false,
          max_output_tokens:300,
          model: "gpt-5.6-luna",
          reasoning: {
            effort: "none",
          },
          input: [
            {
              role: "system",
              content:
                `Categorize this bank transaction into exactly one of these Budget Live categories: ${categoryNames.join(", ")}. ` +
                `Use the merchant name, transaction description, Plaid category, Plaid detailed category, and amount. ` +
                `A negative amount can represent a refund or credit; categorize it according to the underlying purchase type rather than treating it as income. ` +
                `Return only the requested structured result. ` +
                `The reasoning must be a short categorization rationale, not hidden reasoning or chain-of-thought.`,
            },
            {
              role: "user",
              content: JSON.stringify(transaction),
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "transaction_category",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  category: {
                    type: "string",
                    enum: categoryNames,
                  },
                  confidence: {
                    type: "number",
                    minimum: 0,
                    maximum: 1,
                  },
                  reasoning: {
                    type: "string",
                  },
                },
                required: ["category", "confidence", "reasoning"],
                additionalProperties: false,
              },
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error("OpenAI request failed");
      }

     const result = await response.json();

const outputText = result.output
  ?.flatMap((item: {content?:{type:string;text?:string}[]}) => item.content ?? [])
  ?.find((content: {type:string;text?:string}) => content.type === "output_text")
  ?.text;

if (!outputText) {
  console.error("OpenAI response incomplete");
  throw new Error("OpenAI returned no categorization.");
}

const decision = JSON.parse(outputText);

      const category = categories.find(
        (item) => item.name === decision.category
      );

      if (!category) {
        throw new Error("AI returned an invalid category.");
      }

      const { error: applyError } = await userClient.rpc("apply_ai_category", {
        target_transaction: transaction.id,
        target_category: category.id,
       ai_confidence: decision.confidence,
ai_reasoning: decision.reasoning,
ai_model: "gpt-5.6-luna",
      });

      if (applyError) throw applyError;

      processed++;
    }

    return Response.json(
      {
        success: true,
        processed,
      },
      { headers: corsHeaders }
    );
  } catch {
    console.error("Categorization unavailable");

    return Response.json(
      {
        error: "Categorization could not finish. Please retry.",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});