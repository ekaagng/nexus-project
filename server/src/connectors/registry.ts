import type { ProviderConnector, ProviderId } from './types.js';

export class ConnectorRegistry {
  private readonly connectors = new Map<ProviderId, ProviderConnector>();

  register(connector: ProviderConnector): void {
    if (this.connectors.has(connector.provider)) {
      throw new Error(`A connector is already registered for ${connector.provider}.`);
    }
    this.connectors.set(connector.provider, connector);
  }

  get(provider: ProviderId): ProviderConnector | undefined {
    return this.connectors.get(provider);
  }

  list(): ProviderId[] {
    return [...this.connectors.keys()];
  }
}

export const connectorRegistry = new ConnectorRegistry();
