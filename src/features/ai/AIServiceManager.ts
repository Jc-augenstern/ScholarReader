import type { ManagedAiProgress, ManagedAiStatus } from "../../core/models/ai";
import { aiGateway } from "../../platform/tauri/aiGateway";

export class AIServiceManager {
  assessLocalDevice() {
    return aiGateway.assessManaged();
  }

  getLocalStatus() {
    return aiGateway.getManagedStatus();
  }

  prepareLocalAI() {
    return aiGateway.prepareManaged();
  }

  pauseSetup() {
    return aiGateway.pauseManagedSetup();
  }

  cancelSetup() {
    return aiGateway.cancelManagedSetup();
  }

  removeLocalModels() {
    return aiGateway.deleteManagedModels();
  }

  restartLocalAI() {
    return aiGateway.restartManaged();
  }

  testLocalAI() {
    return aiGateway.testManaged();
  }

  onProgress(handler: (progress: ManagedAiProgress) => void) {
    return aiGateway.onManagedProgress(handler);
  }

  onStatus(handler: (status: ManagedAiStatus) => void) {
    return aiGateway.onManagedStatus(handler);
  }
}

export const aiServiceManager = new AIServiceManager();
