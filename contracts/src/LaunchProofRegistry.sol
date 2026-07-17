// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Single-writer, immutable evidence registry for LaunchProof Service Passports.
/// @dev HTTP/MCP execution is off-chain. This contract makes the writer's evidence durable.
contract LaunchProofRegistry {
    uint256 public constant MAX_EVIDENCE_BYTES = 65_536;
    uint256 private constant SECP256K1N_DIV_2 =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    enum PassportStatus {
        NotRehearsable,
        NeedsAttention,
        Verified
    }

    struct RunRecord {
        bytes32 evidenceHash;
        bytes32 manifestHash;
        bytes32 inputHash;
        bytes32 normalizedResultHash;
        bytes32 sourceRevisionHash;
        bytes32 paymentReceiptHash;
        bytes32 previousRunId;
        address provider;
        address anchoredBy;
        uint40 anchoredAt;
        uint16 gateBitmap;
        PassportStatus status;
        bool providerSignatureVerified;
        bool isFixture;
    }

    address public immutable writer;
    mapping(bytes32 runId => RunRecord) private runs;

    error Unauthorized();
    error DuplicateRun();
    error InvalidRecord();
    error EvidenceTooLarge();
    error EvidenceHashMismatch();
    error InvalidGateStatus();
    error InvalidProviderSignature();

    event RunPublished(
        bytes32 indexed runId,
        bytes32 evidenceHash,
        bytes32 manifestHash,
        bytes32 inputHash,
        bytes32 normalizedResultHash,
        bytes32 sourceRevisionHash,
        bytes32 paymentReceiptHash,
        bytes32 previousRunId,
        address indexed provider,
        address indexed anchoredBy,
        uint40 anchoredAt,
        uint16 gateBitmap,
        PassportStatus status,
        bool providerSignatureVerified,
        bool isFixture,
        bytes canonicalEvidence
    );

    constructor(address writer_) {
        if (writer_ == address(0)) revert InvalidRecord();
        writer = writer_;
    }

    function publishRun(
        bytes32 runId,
        RunRecord calldata supplied,
        bytes calldata canonicalEvidence,
        bytes calldata providerSignature
    ) external {
        if (msg.sender != writer) revert Unauthorized();
        if (runs[runId].anchoredAt != 0) revert DuplicateRun();
        if (
            runId == bytes32(0) || supplied.evidenceHash == bytes32(0)
                || supplied.manifestHash == bytes32(0) || supplied.inputHash == bytes32(0)
                || supplied.normalizedResultHash == bytes32(0)
                || supplied.sourceRevisionHash == bytes32(0)
                || supplied.paymentReceiptHash == bytes32(0) || supplied.provider == address(0)
                || supplied.anchoredBy != address(0) || supplied.anchoredAt != 0
        ) {
            revert InvalidRecord();
        }
        if (canonicalEvidence.length > MAX_EVIDENCE_BYTES) revert EvidenceTooLarge();
        if (sha256(canonicalEvidence) != supplied.evidenceHash) revert EvidenceHashMismatch();
        if (!_gateStatusIsValid(supplied.gateBitmap, supplied.status)) revert InvalidGateStatus();

        bool signatureVerified;
        if (providerSignature.length != 0) {
            bytes32 signedHash = keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n32", supplied.manifestHash)
            );
            if (_recover(signedHash, providerSignature) != supplied.provider) {
                revert InvalidProviderSignature();
            }
            signatureVerified = true;
        } else if (supplied.providerSignatureVerified) {
            revert InvalidProviderSignature();
        }
        if (
            (supplied.isFixture || supplied.status == PassportStatus.Verified) && !signatureVerified
        ) {
            revert InvalidProviderSignature();
        }

        RunRecord memory stored = supplied;
        stored.anchoredBy = msg.sender;
        stored.anchoredAt = uint40(block.timestamp);
        stored.providerSignatureVerified = signatureVerified;
        runs[runId] = stored;

        _emitRunPublished(runId, stored, canonicalEvidence);
    }

    function _emitRunPublished(
        bytes32 runId,
        RunRecord memory stored,
        bytes calldata canonicalEvidence
    ) private {
        emit RunPublished(
            runId,
            stored.evidenceHash,
            stored.manifestHash,
            stored.inputHash,
            stored.normalizedResultHash,
            stored.sourceRevisionHash,
            stored.paymentReceiptHash,
            stored.previousRunId,
            stored.provider,
            stored.anchoredBy,
            stored.anchoredAt,
            stored.gateBitmap,
            stored.status,
            stored.providerSignatureVerified,
            stored.isFixture,
            canonicalEvidence
        );
    }

    function getRun(bytes32 runId) external view returns (RunRecord memory) {
        return runs[runId];
    }

    function hasRun(bytes32 runId) external view returns (bool) {
        return runs[runId].anchoredAt != 0;
    }

    /// @dev Two bits per gate: 0=not_tested, 1=pass, 2=fail; 3 is invalid.
    function _gateStatusIsValid(uint16 bitmap, PassportStatus status) private pure returns (bool) {
        // Five gates occupy exactly ten bits. Reject non-canonical high bits so
        // independent verifiers cannot disagree about the represented state.
        if (bitmap >> 10 != 0) return false;
        bool firstFourTested = true;
        bool allFirstFourPass = true;
        bool anyFirstFourFail;
        for (uint256 i; i < 5; ++i) {
            uint16 value = (bitmap >> (i * 2)) & 3;
            if (value == 3) return false;
            if (i < 4 && value == 0) firstFourTested = false;
            if (i < 4 && value != 1) allFirstFourPass = false;
            if (i < 4 && value == 2) anyFirstFourFail = true;
        }
        uint16 paid = (bitmap >> 8) & 3;
        if (status == PassportStatus.Verified) {
            // A paid Service Passport is verified only after all five observable
            // claims, including settlement-backed delivery, have passed.
            return allFirstFourPass && paid == 1;
        }
        if (status == PassportStatus.NeedsAttention) {
            return firstFourTested && (anyFirstFourFail || paid != 1);
        }
        return !firstFourTested;
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > SECP256K1N_DIV_2 || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
