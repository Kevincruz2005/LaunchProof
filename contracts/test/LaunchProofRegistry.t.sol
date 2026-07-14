// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LaunchProofRegistry} from "../src/LaunchProofRegistry.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function expectRevert(bytes4 selector) external;
}

contract LaunchProofRegistryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant PROVIDER_KEY = 0xA11CE;
    address private writer = address(0xBEEF);
    LaunchProofRegistry private registry;

    function setUp() public {
        registry = new LaunchProofRegistry(writer);
    }

    function testPublishReadbackAndSignature() public {
        bytes memory evidence = bytes("{\"schema_version\":\"1.0\"}");
        bytes32 manifestHash = sha256(bytes("manifest"));
        LaunchProofRegistry.RunRecord memory record = _record(evidence, manifestHash, 341, 2);
        bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", manifestHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PROVIDER_KEY, signedHash);
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(1)), record, evidence, abi.encodePacked(r, s, v));
        LaunchProofRegistry.RunRecord memory stored = registry.getRun(bytes32(uint256(1)));
        assert(stored.anchoredBy == writer);
        assert(stored.providerSignatureVerified);
        assert(registry.hasRun(bytes32(uint256(1))));
    }

    function testOnlyWriterAndWriteOnce() public {
        bytes memory evidence = bytes("{}");
        LaunchProofRegistry.RunRecord memory record = _record(evidence, sha256("m"), 341, 2);
        vm.expectRevert(LaunchProofRegistry.Unauthorized.selector);
        registry.publishRun(bytes32(uint256(2)), record, evidence, "");
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(2)), record, evidence, "");
        vm.expectRevert(LaunchProofRegistry.DuplicateRun.selector);
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(2)), record, evidence, "");
    }

    function testRejectsHashAndGateMismatch() public {
        bytes memory evidence = bytes("{}");
        LaunchProofRegistry.RunRecord memory record = _record(evidence, sha256("m"), 341, 2);
        record.evidenceHash = sha256("wrong");
        vm.expectRevert(LaunchProofRegistry.EvidenceHashMismatch.selector);
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(3)), record, evidence, "");

        record.evidenceHash = sha256(evidence);
        record.gateBitmap = 0;
        record.status = LaunchProofRegistry.PassportStatus.Verified;
        vm.expectRevert(LaunchProofRegistry.InvalidGateStatus.selector);
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(4)), record, evidence, "");
    }

    function testEnforcesExactStatusMapping() public {
        bytes memory evidence = bytes("{}");

        // All core gates ran and one failed: only NeedsAttention is valid.
        LaunchProofRegistry.RunRecord memory failedCore = _record(evidence, sha256("m"), 86, 0);
        vm.expectRevert(LaunchProofRegistry.InvalidGateStatus.selector);
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(5)), failedCore, evidence, "");
        failedCore.status = LaunchProofRegistry.PassportStatus.NeedsAttention;
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(5)), failedCore, evidence, "");

        // All core gates passed but paid delivery failed: NeedsAttention is valid.
        LaunchProofRegistry.RunRecord memory paidFailure = _record(evidence, sha256("m"), 597, 1);
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(6)), paidFailure, evidence, "");

        // An untested core gate maps to NotRehearsable, never NeedsAttention.
        LaunchProofRegistry.RunRecord memory incomplete = _record(evidence, sha256("m"), 84, 1);
        vm.expectRevert(LaunchProofRegistry.InvalidGateStatus.selector);
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(7)), incomplete, evidence, "");
        incomplete.status = LaunchProofRegistry.PassportStatus.NotRehearsable;
        vm.prank(writer);
        registry.publishRun(bytes32(uint256(7)), incomplete, evidence, "");
    }

    function _record(bytes memory evidence, bytes32 manifestHash, uint16 bitmap, uint8 status)
        private
        returns (LaunchProofRegistry.RunRecord memory)
    {
        return LaunchProofRegistry.RunRecord({
            evidenceHash: sha256(evidence),
            manifestHash: manifestHash,
            inputHash: sha256("input"),
            normalizedResultHash: sha256("result"),
            sourceRevisionHash: sha256("source"),
            paymentReceiptHash: sha256("payment"),
            previousRunId: bytes32(0),
            provider: vm.addr(PROVIDER_KEY),
            anchoredBy: address(0),
            anchoredAt: 0,
            gateBitmap: bitmap,
            status: LaunchProofRegistry.PassportStatus(status),
            providerSignatureVerified: false,
            isFixture: true
        });
    }
}
