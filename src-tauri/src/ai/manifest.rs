pub const RUNTIME_VERSION: &str = "b10603";
pub const RUNTIME_ARCHIVE_NAME: &str = "llama-runtime-b10603.zip";
pub const RUNTIME_ARCHIVE_SIZE: u64 = 18_063_576;
pub const RUNTIME_ARCHIVE_SHA256: &str =
    "878efa5bc0cdeb9c3fcb96335521556e06ca9252f83de3a1d924981918607702";

#[derive(Debug, Clone, Copy)]
pub struct ModelManifest {
    pub id: &'static str,
    pub display_name: &'static str,
    pub filename: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub download_url: &'static str,
    pub license_url: &'static str,
    pub license_sha256: &'static str,
    pub minimum_memory_bytes: u64,
}

pub const QWEN3_06B: ModelManifest = ModelManifest {
    id: "qwen3-0.6b-q8_0",
    display_name: "轻量本地 AI",
    filename: "Qwen3-0.6B-Q8_0.gguf",
    size: 639_446_688,
    sha256: "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031",
    download_url: "https://modelscope.cn/models/Qwen/Qwen3-0.6B-GGUF/resolve/6abe20cd0aed577f4d0b267935868ecae190aee9/Qwen3-0.6B-Q8_0.gguf",
    license_url: "https://modelscope.cn/models/Qwen/Qwen3-0.6B-GGUF/resolve/09b810292b018ad3e58d7d9e16482f07bc5a0b54/LICENSE",
    license_sha256: "5de36594c10839788a8c589443a8ef9d8b8d17c65a1b5807206ae037fc36c6bd",
    minimum_memory_bytes: 4 * 1024 * 1024 * 1024,
};

pub const QWEN3_17B: ModelManifest = ModelManifest {
    id: "qwen3-1.7b-q8_0",
    display_name: "均衡本地 AI",
    filename: "Qwen3-1.7B-Q8_0.gguf",
    size: 1_834_426_016,
    sha256: "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a",
    download_url: "https://modelscope.cn/models/Qwen/Qwen3-1.7B-GGUF/resolve/dc80e1956e7551cd4aa5309c914e767b69188639/Qwen3-1.7B-Q8_0.gguf",
    license_url: "https://modelscope.cn/models/Qwen/Qwen3-1.7B-GGUF/resolve/0c4504680bce8788103ecd64f4d29ef91e915545/LICENSE",
    license_sha256: "5de36594c10839788a8c589443a8ef9d8b8d17c65a1b5807206ae037fc36c6bd",
    minimum_memory_bytes: 8 * 1024 * 1024 * 1024,
};

pub fn select_model(total_memory_bytes: u64) -> &'static ModelManifest {
    if total_memory_bytes >= QWEN3_17B.minimum_memory_bytes {
        &QWEN3_17B
    } else {
        &QWEN3_06B
    }
}

pub fn model_by_id(id: &str) -> Option<&'static ModelManifest> {
    match id {
        "qwen3-0.6b-q8_0" => Some(&QWEN3_06B),
        "qwen3-1.7b-q8_0" => Some(&QWEN3_17B),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hardware_policy_selects_a_real_pinned_model() {
        assert_eq!(select_model(4 * 1024 * 1024 * 1024).id, QWEN3_06B.id);
        assert_eq!(select_model(8 * 1024 * 1024 * 1024).id, QWEN3_17B.id);
        assert_eq!(QWEN3_17B.size, 1_834_426_016);
        assert_eq!(QWEN3_17B.sha256.len(), 64);
    }
}
