import { config as dotenv } from "dotenv";
import {
  createWalletClient,
  http,
  getContract,
  erc20Abi,
  parseUnits,
  maxUint256,
  publicActions,
  concat,
  numberToHex,
  size,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { scroll } from "viem/chains";
import { wethAbi } from "./abi/weth-abi";

dotenv();

// Load environment variables
const { PRIVATE_KEY, ZERO_EX_API_KEY, ALCHEMY_HTTP_TRANSPORT_URL } = process.env;

// Validate requirements
if (!PRIVATE_KEY || !ZERO_EX_API_KEY || !ALCHEMY_HTTP_TRANSPORT_URL) {
  throw new Error("Missing required environment variables.");
}

// Setup wallet client
const client = createWalletClient({
  account: privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`),
  chain: scroll,
  transport: http(ALCHEMY_HTTP_TRANSPORT_URL),
}).extend(publicActions);

const headers = new Headers({
  "Content-Type": "application/json",
  "0x-api-key": ZERO_EX_API_KEY,
  "0x-version": "v2",
});

const [address] = await client.getAddresses();

const weth = getContract({
  address: "0x5300000000000000000000000000000000000004",
  abi: wethAbi,
  client,
});
const wsteth = getContract({
  address: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32",
  abi: erc20Abi,
  client,
});

// Utility function for fetching data
async function fetchApi(url: string, params: URLSearchParams) {
  try {
    const response = await fetch(`${url}?${params.toString()}`, { headers });
    if (!response.ok) {
      throw new Error(`Error fetching data from ${url}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("API Fetch Error:", error);
    throw error;
  }
}

// Function to display percentage breakdown of liquidity sources
function displayLiquiditySources(route: any) {
  const totalBps = route.fills.reduce((acc: number, fill: any) => acc + parseInt(fill.proportionBps), 0);
  console.log(`${route.fills.length} Sources`);
  route.fills.forEach((fill: any) => {
    const percentage = (parseInt(fill.proportionBps) / 100).toFixed(2);
    console.log(`${fill.source}: ${percentage}%`);
  });
}

// Function to display buy/sell taxes for tokens
function displayTokenTaxes(tokenMetadata: any) {
  const displayTax = (type: string, buyTax: string, sellTax: string) => {
    if (parseFloat(buyTax) > 0 || parseFloat(sellTax) > 0) {
      console.log(`${type} Buy Tax: ${buyTax}%`);
      console.log(`${type} Sell Tax: ${sellTax}%`);
    }
  };

  const buyToken = tokenMetadata.buyToken;
  const sellToken = tokenMetadata.sellToken;

  displayTax("Buy Token", (parseInt(buyToken.buyTaxBps) / 100).toFixed(2), (parseInt(buyToken.sellTaxBps) / 100).toFixed(2));
  displayTax("Sell Token", (parseInt(sellToken.buyTaxBps) / 100).toFixed(2), (parseInt(sellToken.sellTaxBps) / 100).toFixed(2));
}

// Function to fetch liquidity sources on Scroll
async function getLiquiditySources() {
  const chainId = client.chain.id.toString();
  const sourcesData = await fetchApi("https://api.0x.org/swap/v1/sources", new URLSearchParams({ chainId }));
  console.log("Liquidity sources for Scroll chain:", Object.keys(sourcesData.sources).join(", "));
}

// Main execution function
async function main() {
  await getLiquiditySources();

  const decimals = (await weth.read.decimals()) as number;
  const sellAmount = parseUnits("0.1", decimals);
  const affiliateFeeBps = "100"; // 1%
  const surplusCollection = "true";

  const priceParams = new URLSearchParams({
    chainId: client.chain.id.toString(),
    sellToken: weth.address,
    buyToken: wsteth.address,
    sellAmount: sellAmount.toString(),
    taker: client.account.address,
    affiliateFee: affiliateFeeBps,
    surplusCollection,
  });

  const price = await fetchApi("https://api.0x.org/swap/permit2/price", priceParams);
  console.log("Price response:", price);

  // Handle approval if needed
  if (price.issues.allowance !== null) {
    try {
      const { request } = await weth.simulate.approve([price.issues.allowance.spender, maxUint256]);
      console.log("Approving Permit2 to spend WETH...", request);
      const hash = await weth.write.approve(request.args);
      console.log("Approved Permit2 to spend WETH:", await client.waitForTransactionReceipt({ hash }));
    } catch (error) {
      console.error("Error approving Permit2:", error);
    }
  } else {
    console.log("WETH already approved for Permit2");
  }

  const quote = await fetchApi("https://api.0x.org/swap/permit2/quote", priceParams);
  console.log("Quote response:", quote);

  if (quote.route) displayLiquiditySources(quote.route);
  if (quote.tokenMetadata) displayTokenTaxes(quote.tokenMetadata);

  // Additional logic for signature, transaction submission, etc.
}

main();
