const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.OPENCLAW_SUPABASE_URL;
const supabaseKey = process.env.OPENCLAW_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    throw new Error("OPENCLAW_SUPABASE_URL and OPENCLAW_SUPABASE_ANON_KEY are required");
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSupabase() {
    console.log("Testing Supabase Insert...");
    // Create a dummy 4096-d vector (zeros)
    const dummyVector = Array(4096).fill(0);

    const { data, error } = await supabase
        .from('page_sections')
        .insert([{
            content: "Test connection insert",
            metadata: { source: "test" },
            embedding: dummyVector
        }]);

    if (error) {
        console.error("Supabase Error:", error);
    } else {
        console.log("Supabase Insert Success:", data || "No data returned but no error.");
    }
}

testSupabase();
