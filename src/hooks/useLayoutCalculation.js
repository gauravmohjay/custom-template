// hooks/useLayoutCalculation.js - Hook for responsive layout calculations
import { useMemo } from 'react';

/**
 * useLayoutCalculation manages responsive layout percentages
 * Adapts main view and sidebar widths based on presence of co-hosts
 */
export function useLayoutCalculation({ hasCoHosts }) {
  const layout = useMemo(() => {
    // If no co-hosts: main 90%, sidebar 10%
    // If co-hosts present: main 80%, sidebar 20%
    if (hasCoHosts) {
      return {
        mainWidth: 80,
        sidebarWidth: 20
      };
    }
    
    return {
      mainWidth: 90,
      sidebarWidth: 10
    };
  }, [hasCoHosts]);

  return layout;
}