const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const ESCROW = "0x34336C18E764B2ae28d28E90E040E57d6C74DAce";
  const TEE_PK = "0x8bb3a7bfe42860b87b97a545eeda68f0c2f28815487d1a67d0cb7fec4a0ef3f6";
  const teeSigner = new hre.ethers.Wallet(TEE_PK, hre.ethers.provider);
  
  console.log("TEE Signer:", teeSigner.address);

  // 1. Deploy 2 test tokens
  const TestToken = await hre.ethers.getContractFactory("TestToken");
  const tokenA = await TestToken.deploy("Test USDT", "tUSDT", hre.ethers.parseEther("1000000"));
  await tokenA.waitForDeployment();
  const tokenAAddr = await tokenA.getAddress();
  console.log("tUSDT deployed:", tokenAAddr);

  const tokenB = await TestToken.deploy("Test BNB", "tBNBT", hre.ethers.parseEther("1000000"));
  await tokenB.waitForDeployment();
  const tokenBAddr = await tokenB.getAddress();
  console.log("tBNBT deployed:", tokenBAddr);

  // 2. Transfer tokens to TEE signer (second trader)
  const transferTx = await tokenB.transfer(teeSigner.address, hre.ethers.parseEther("1000"));
  await transferTx.wait();
  console.log("Sent 1000 tBNBT to TEE signer");

  const escrow = await hre.ethers.getContractAt("DarkPoolEscrow", ESCROW);

  // 3. Maker deposits tUSDT
  const makerOrderId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("maker-order-002"));
  const makerAmount = hre.ethers.parseEther("100");
  
  const approveTx1 = await tokenA.approve(ESCROW, makerAmount);
  await approveTx1.wait();
  const depositTx1 = await escrow.deposit(makerOrderId, tokenAAddr, makerAmount);
  await depositTx1.wait();
  console.log("✓ Maker deposited 100 tUSDT, tx:", depositTx1.hash);

  // 4. Taker deposits tBNBT
  const takerOrderId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("taker-order-002"));
  const takerAmount = hre.ethers.parseEther("0.5");
  
  const tokenBTee = tokenB.connect(teeSigner);
  const approveTx2 = await tokenBTee.approve(ESCROW, takerAmount);
  await approveTx2.wait();
  const escrowTee = escrow.connect(teeSigner);
  const depositTx2 = await escrowTee.deposit(takerOrderId, tokenBAddr, takerAmount);
  await depositTx2.wait();
  console.log("✓ Taker deposited 0.5 tBNBT, tx:", depositTx2.hash);

  // 5. Build TEE signature — must match contract's abi.encodePacked
  const swapId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("swap-002"));
  const makerFill = hre.ethers.parseEther("100");
  const takerFill = hre.ethers.parseEther("0.5");
  
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  
  // abi.encodePacked(chainid, address, bytes32, bytes32, bytes32, uint256, uint256)
  // chainid = uint256 (32 bytes), address = 20 bytes, rest = 32 bytes each
  const packed = hre.ethers.solidityPacked(
    ["uint256", "address", "bytes32", "bytes32", "bytes32", "uint256", "uint256"],
    [chainId, ESCROW, swapId, makerOrderId, takerOrderId, makerFill, takerFill]
  );
  const structHash = hre.ethers.keccak256(packed);
  
  // Contract uses toEthSignedMessageHash, and ethers.signMessage does the same
  const signature = await teeSigner.signMessage(hre.ethers.getBytes(structHash));
  console.log("✓ TEE signature generated");

  // Verify locally
  const onChainHash = await escrow.getSwapStructHash(swapId, makerOrderId, takerOrderId, makerFill, takerFill);
  console.log("On-chain struct hash:", onChainHash);
  console.log("Local struct hash:   ", structHash);
  console.log("Match:", onChainHash === structHash);

  // 6. Execute swap
  try {
    const swapTx = await escrowTee.executeSwap(
      swapId, makerOrderId, takerOrderId, makerFill, takerFill, signature
    );
    const receipt = await swapTx.wait();
    console.log("\n═══════════════════════════════════════");
    console.log("  ✅ SWAP EXECUTED SUCCESSFULLY!");
    console.log("═══════════════════════════════════════");
    console.log("TX Hash:", swapTx.hash);
    console.log("Gas used:", receipt.gasUsed.toString());
    console.log("BSCScan: https://testnet.bscscan.com/tx/" + swapTx.hash);
  } catch (e) {
    console.log("\n❌ Swap failed:", e.message?.slice(0, 200));
  }
}

main().catch(console.error);
