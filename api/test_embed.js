const testEmbedding = async () => {
    const apiKey = process.env.PHAYA_API_KEY;
    if (!apiKey) {
        throw new Error("PHAYA_API_KEY is required");
    }

    const response = await fetch("https://api.phaya.io/api/v1/embedding/create", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ input: ["test string"] })
    });
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
    if (data.data && data.data[0] && data.data[0].embedding) {
        console.log("Vector Dimension:", data.data[0].embedding.length);
    }
};
testEmbedding();
