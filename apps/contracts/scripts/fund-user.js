const hre = require("hardhat");

async function main() {
  const [sender] = await hre.ethers.getSigners();
  const target = process.env.TARGET || "0xbF9CbFfC4BFccAc044768c371b1F37Af16A65246";
  const gasAmount = hre.ethers.parseEther(process.env.GAS || "0.05");
  const tokenAmount = hre.ethers.parseEther(process.env.AMOUNT || "10000");

  const USDT = process.env.USDT || "0xF34fB8fDe28c4162F998Cf9B42068a828a417bC3";
  const BNB = process.env.BNB || "0x1Ef37FA15bc5933398a1177EF04302399A4588d4";

  console.log(`Sender: ${sender.address}`);
  console.log(`Target: ${target}`);

  // 1. gas (tBNB)
  console.log(`\n[1/3] Sending ${hre.ethers.formatEther(gasAmount)} tBNB for gas...`);
  const gasTx = await sender.sendTransaction({ to: target, value: gasAmount });
  console.log(`  tx: ${gasTx.hash}`);
  await gasTx.wait();

  // 2. tUSDT
  console.log(`\n[2/3] Sending ${hre.ethers.formatEther(tokenAmount)} tUSDT...`);
  const usdt = await hre.ethers.getContractAt("TestToken", USDT);
  const usdtTx = await usdt.transfer(target, tokenAmount);
  console.log(`  tx: ${usdtTx.hash}`);
  await usdtTx.wait();

  // 3. tBNBT
  console.log(`\n[3/3] Sending ${hre.ethers.formatEther(tokenAmount)} tBNBT...`);
  const bnb = await hre.ethers.getContractAt("TestToken", BNB);
  const bnbTx = await bnb.transfer(target, tokenAmount);
  console.log(`  tx: ${bnbTx.hash}`);
  await bnbTx.wait();

  // summary
  const balBNB = await hre.ethers.provider.getBalance(target);
  const balUSDT = await usdt.balanceOf(target);
  const balBNBT = await bnb.balanceOf(target);
  console.log(`\n=== Final balances at ${target} ===`);
  console.log(`  tBNB : ${hre.ethers.formatEther(balBNB)}`);
  console.log(`  tUSDT: ${hre.ethers.formatEther(balUSDT)}`);
  console.log(`  tBNBT: ${hre.ethers.formatEther(balBNBT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
