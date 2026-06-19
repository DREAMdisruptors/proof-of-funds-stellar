const form = document.getElementById("form");
const submitBtn = document.getElementById("submit");
const result = document.getElementById("result");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const balance = document.getElementById("balance").value;
  const threshold = document.getElementById("threshold").value;

  submitBtn.disabled = true;
  result.className = "pending";
  result.textContent = "Generating proof and verifying on Stellar testnet… (a few seconds)";

  try {
    const res = await fetch("/api/prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ balance, threshold }),
    });
    const data = await res.json();

    if (!data.ok) {
      result.className = "fail";
      result.textContent = `Error: ${data.error}`;
    } else if (data.verified) {
      result.className = "pass";
      result.textContent =
        `✅ ${data.message}\n\nContract: ${data.contractId}\n${data.explorerUrl}`;
    } else {
      result.className = "fail";
      result.textContent = `❌ ${data.message}`;
    }
  } catch (err) {
    result.className = "fail";
    result.textContent = `Request failed: ${err}`;
  } finally {
    submitBtn.disabled = false;
  }
});
