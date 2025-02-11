import DiContainer, { LocatableNestedDependenciesDict } from "../DiContainer";

export async function deepLocateDeps(
  serviceLocator: DiContainer,
  locateDeps: LocatableNestedDependenciesDict
): Promise<any> {
  serviceLocator.logger.debug('deepLocateDeps: starting with', locateDeps);
  const deps: any = Array.isArray(locateDeps) ? [] : {};
  for (const key of Object.keys(locateDeps)) {
    const depNameOrNested = locateDeps[key];
    serviceLocator.logger.debug(`Resolving dependency for key: ${key}`, depNameOrNested);
    try {
      const dep =
        typeof depNameOrNested !== 'string'
          ? await deepLocateDeps(serviceLocator, depNameOrNested)
          : await serviceLocator.get(depNameOrNested);
      serviceLocator.logger.debug(`Resolved dependency for key: ${key}`, dep);
      deps[key] = dep;
    } catch (err) {
      serviceLocator.logger.debug(`Error resolving dependency for ${depNameOrNested}:`, err);
      throw err;
    }
  }
  serviceLocator.logger.debug('deepLocateDeps: finished with', deps);
  return deps;
}
