let rootClient = null;

export function registerRootClient(client) {
  rootClient = client;
}

export function getRootClient() {
  return rootClient;
}

export function offlineMutation(key, config) {
  const callConfig = { ...config };
  if (rootClient) {
    const defaults = { mutationFn: config.mutationFn };
    if (config.retry !== undefined) defaults.retry = config.retry;
    if (config.networkMode !== undefined) defaults.networkMode = config.networkMode;
    if (!rootClient.getMutationDefaults([key])) {
      rootClient.setMutationDefaults([key], defaults);
    }
  }
  callConfig.mutationKey = [key];
  return callConfig;
}

export function resumePendingMutations(client) {
  const target = client || rootClient;
  if (target) target.resumePausedMutations().catch(() => {});
}