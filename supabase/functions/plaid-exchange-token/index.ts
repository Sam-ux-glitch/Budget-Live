import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the signed-in Budget Live user
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
      throw new Error("Unable to identify signed-in user");
    }

    const { public_token } = await req.json();

    if (!public_token) {
      throw new Error("Missing public_token");
    }

    const clientId = Deno.env.get("PLAID_CLIENT_ID");
    const secret =
      Deno.env.get("PLAID_SANDBOX_SECRET") ||
      Deno.env.get("PLAID_SECRET");

    if (!clientId || !secret) {
      throw new Error("Missing Plaid credentials");
    }

    // Exchange temporary public token with Plaid
    const response = await fetch(
      "https://sandbox.plaid.com/item/public_token/exchange",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          secret,
          public_token,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Plaid exchange failed");

      return new Response(
        JSON.stringify({ error: "Plaid token exchange failed" }),
        {
          status: response.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const vaultName = `plaid_${data.item_id}`;

    // Store the Plaid access token directly in encrypted Vault
    const { error: vaultError } = await admin.rpc(
      "store_plaid_token_in_vault",
      {
        token_value: data.access_token,
        token_name: vaultName,
      }
    );

    if (vaultError) {
      console.error("Vault storage error:", vaultError);
      throw new Error("Unable to securely save Plaid connection");
    }

    // Keep only non-sensitive identifying information in this table
    const { error: tokenRecordError } = await admin
      .from("plaid_private_tokens")
      .upsert(
        {
          user_id: user.id,
          plaid_item_id: data.item_id,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "plaid_item_id",
        }
      );

    if (tokenRecordError) {
      console.error("Token record error:", tokenRecordError);
      throw new Error("Unable to save Plaid token record");
    }

    // Store non-sensitive connection information
    const { error: connectionError } = await admin
      .from("bank_connections")
      .upsert(
        {
          user_id: user.id,
          plaid_item_id: data.item_id,
          status: "active",
          last_synced_at: null,
        },
        {
          onConflict: "plaid_item_id",
        }
      );

    if (connectionError) {
      console.error("Connection storage error:", connectionError);
      throw new Error("Unable to save bank connection");
    }

    // Never send the Plaid access token to the browser
    return new Response(
      JSON.stringify({
        success: true,
        item_id: data.item_id,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});