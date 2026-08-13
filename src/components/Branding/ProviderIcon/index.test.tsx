import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderIcon } from './index';

const branding = { isCustomBranding: true };

vi.mock('@/const/version', () => ({
  get isCustomBranding() {
    return branding.isCustomBranding;
  },
}));

vi.mock('@/components/Branding/ProductLogo', () => ({
  ProductLogo: ({ size }: { size?: number }) => <div data-size={size} data-testid="product-logo" />,
}));

vi.mock('@lobehub/icons', () => ({
  ProviderIcon: ({ provider, size }: { provider?: string; size?: number }) => (
    <div data-provider={provider} data-size={size} data-testid="vendor-icon" />
  ),
}));

beforeEach(() => {
  branding.isCustomBranding = true;
});

afterEach(() => {
  cleanup();
});

describe('Branding ProviderIcon', () => {
  it('renders the product logo for the provider this distribution brands as its own', () => {
    render(<ProviderIcon provider={BRANDING_PROVIDER} size={18} />);

    // Stored usage rows carry the upstream provider id, so without this the
    // spend table labels our own models with LobeHub's mark.
    expect(screen.getByTestId('product-logo')).toHaveAttribute('data-size', '18');
    expect(screen.queryByTestId('vendor-icon')).not.toBeInTheDocument();
  });

  it('leaves every other provider to its vendor icon', () => {
    render(<ProviderIcon provider="anthropic" size={18} />);

    expect(screen.getByTestId('vendor-icon')).toHaveAttribute('data-provider', 'anthropic');
    expect(screen.queryByTestId('product-logo')).not.toBeInTheDocument();
  });

  it('substitutes nothing on an unbranded build', () => {
    branding.isCustomBranding = false;

    render(<ProviderIcon provider={BRANDING_PROVIDER} size={18} />);

    // Upstream the two resolve to the same mark anyway; keeping the vendor icon
    // means this component changes nothing for builds that did not rebrand.
    expect(screen.getByTestId('vendor-icon')).toHaveAttribute('data-provider', BRANDING_PROVIDER);
    expect(screen.queryByTestId('product-logo')).not.toBeInTheDocument();
  });
});
