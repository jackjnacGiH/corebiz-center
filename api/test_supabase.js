const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://owoedccmuqnzdtxvywgt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93b2VkY2NtdXFuemR0eHZ5d2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTMyOTQsImV4cCI6MjA4NzkyOTI5NH0.OfOaHTsJx-M36N5G54PjC4n-8-qZVQNVUuLdb10RO4M';
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
