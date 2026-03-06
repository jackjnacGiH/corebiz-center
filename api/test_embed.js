const testEmbedding = async () => {
    const response = await fetch("https://api.phaya.io/api/v1/embedding/create", {
        method: "POST",
        headers: {
            "Authorization": "Bearer pk_gd7O1pA7AzzOBoEwbDIGpIFoAo1zpLi5duzVFD0xnA198o8k",
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
