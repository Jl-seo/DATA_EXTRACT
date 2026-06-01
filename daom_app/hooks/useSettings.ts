import { useSiteConfig, useUpdateSiteConfig, AppConfig } from "@/queries/env";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SiteConfig } from "@/scheme/siteConfig";

export default function useSettings() {
  const queryClient = useQueryClient();
  const { data: siteConfig, isFetching: isSiteConfigFetching } = useSiteConfig();
  const { mutate: updateSiteConfigData, isPending: isSavingSiteConfig } = useUpdateSiteConfig();

  // Refs for checking icon URLs (no changes needed)
  const faviconObjectUrlRef = useRef<string | null>(null);
  const appIconObjectUrlRef = useRef<string | null>(null);
  const loginIconObjectUrlRef = useRef<string | null>(null);
  const characterIconObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (faviconObjectUrlRef.current) URL.revokeObjectURL(faviconObjectUrlRef.current);
      if (appIconObjectUrlRef.current) URL.revokeObjectURL(appIconObjectUrlRef.current);
      if (loginIconObjectUrlRef.current) URL.revokeObjectURL(loginIconObjectUrlRef.current);
      if (characterIconObjectUrlRef.current) URL.revokeObjectURL(characterIconObjectUrlRef.current);
    };
  }, []);

  // --- Branding Settings (still using local state for form submission pattern for now) ---
  // Ideally these should also be optimistic, but for now focusing on Theme responsiveness
  const [appName, setAppName] = useState(siteConfig?.app_name);
  const [appDescription, setAppDescription] = useState(siteConfig?.app_description ?? '문서 자동화');

  // Sync basic info when siteConfig loads
  useEffect(() => {
    if (siteConfig?.app_name !== undefined) setAppName(siteConfig.app_name);
  }, [siteConfig?.app_name]);

  useEffect(() => {
    if (siteConfig?.app_description !== undefined) setAppDescription(siteConfig.app_description);
  }, [siteConfig?.app_description]);

  const [faviconUrl, setFaviconUrl] = useState(siteConfig?.app_favicon?.src);
  const [appIconUrl, setAppIconUrl] = useState(siteConfig?.app_icon?.src);
  const [loginIconUrl, setLoginIconUrl] = useState(siteConfig?.login_icon?.src);
  const [characterIconUrl, setCharacterIconUrl] = useState(siteConfig?.character_icon?.src);

  const [pendingFaviconFile, setPendingFaviconFile] = useState<File | null>(null);
  const [pendingAppIconFile, setPendingAppIconFile] = useState<File | null>(null);
  const [pendingLoginIconFile, setPendingLoginIconFile] = useState<File | null>(null);
  const [pendingCharacterIconFile, setPendingCharacterIconFile] = useState<File | null>(null);

  // Sync icon URLs if they change from server (and not currently pending local change)
  useEffect(() => { if (!pendingFaviconFile) setFaviconUrl(siteConfig?.app_favicon?.src) }, [siteConfig?.app_favicon?.src, pendingFaviconFile]);
  useEffect(() => { if (!pendingAppIconFile) setAppIconUrl(siteConfig?.app_icon?.src) }, [siteConfig?.app_icon?.src, pendingAppIconFile]);
  useEffect(() => { if (!pendingLoginIconFile) setLoginIconUrl(siteConfig?.login_icon?.src) }, [siteConfig?.login_icon?.src, pendingLoginIconFile]);
  useEffect(() => { if (!pendingCharacterIconFile) setCharacterIconUrl(siteConfig?.character_icon?.src) }, [siteConfig?.character_icon?.src, pendingCharacterIconFile]);

  // --- Theme Settings (Optimistic & Auto-save) ---
  // Derive state directly from siteConfig to ensure synchronization across components
  const theme = siteConfig?.theme ?? 'system';
  const radius = siteConfig?.radius ?? 0.5;
  const density = siteConfig?.density ?? 'normal';
  const primaryColor = siteConfig?.primary_color ?? 'oklch(0.6723 0.1606 244.9955)';

  // Accumulate updates for debounce
  const pendingUpdatesRef = useRef<Partial<SiteConfig>>({});
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const optimisticUpdate = (updates: Partial<SiteConfig>) => {
    // 1. Update React Query Cache immediately
    queryClient.setQueryData(['_next', '/app_config'], (old: AppConfig | undefined) => {
      if (!old) return old;
      return {
        ...old,
        site_config: {
          ...old.site_config,
          ...updates
        }
      };
    });

    // 2. Queue for server save
    debouncedSave(updates);
  };

  const debouncedSave = (updates: Partial<SiteConfig>) => {
    // Merge new updates into pending
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const updatesToSave = { ...pendingUpdatesRef.current };
      pendingUpdatesRef.current = {}; // Clear pending

      const formData = new FormData();
      if (updatesToSave.theme) formData.append('theme', updatesToSave.theme);
      if (updatesToSave.radius !== undefined) formData.append('radius', updatesToSave.radius.toString());
      if (updatesToSave.density) formData.append('density', updatesToSave.density);
      if (updatesToSave.primary_color) formData.append('primary_color', updatesToSave.primary_color);

      updateSiteConfigData(formData, {
        onSuccess: () => {
          // Quiet success
        },
        onError: (error) => {
          toast.error(`설정 저장 실패: ${error.message}`);
          // Optionally revert cache here if needed, but for now keep it simple
        }
      });
    }, 800);
  };

  const updateTheme = (newTheme: string) => optimisticUpdate({ theme: newTheme as any });
  const updateRadius = (newRadius: number) => optimisticUpdate({ radius: newRadius });
  const updateDensity = (newDensity: string) => optimisticUpdate({ density: newDensity as any });
  const updatePrimaryColor = (newColor: string) => optimisticUpdate({ primary_color: newColor });


  // --- Branding Save (Manual) ---
  const handleDefaultSettingsSave = async () => {
    if (isSavingSiteConfig) return;

    const currentDescription = appDescription;
    const formData = new FormData();
    // Only append branding fields here
    if (appName) formData.append('app_name', appName);
    if (currentDescription !== undefined) formData.append('app_description', currentDescription);

    // Files
    if (pendingFaviconFile) formData.append('app_favicon_file', pendingFaviconFile);
    else if (faviconUrl) formData.append('app_favicon', faviconUrl ?? '');
    else formData.append('app_favicon', '/favicon.ico');

    if (pendingAppIconFile) formData.append('app_icon_file', pendingAppIconFile);
    else if (appIconUrl) formData.append('app_icon', appIconUrl ?? '');
    else formData.append('app_icon', 'undefined');

    if (pendingLoginIconFile) formData.append('login_icon_file', pendingLoginIconFile);
    else if (loginIconUrl) formData.append('login_icon', loginIconUrl ?? '');
    else formData.append('login_icon', 'undefined');

    if (pendingCharacterIconFile) formData.append('character_icon_file', pendingCharacterIconFile);
    else if (characterIconUrl) formData.append('character_icon', characterIconUrl ?? '');
    else formData.append('character_icon', 'undefined');

    updateSiteConfigData(formData, {
      onSuccess: (result) => {
        if (result.success) {
          toast.success(`기본 설정이 저장되었습니다.`);
          setPendingFaviconFile(null);
          setPendingAppIconFile(null);
          setPendingLoginIconFile(null);
          setPendingCharacterIconFile(null);
        }
      },
      onError: (error) => {
        toast.error(`설정 저장에 실패했습니다: ${error.message}`);
      }
    });
  };

  const appDescriptionRef = useRef<HTMLTextAreaElement | null>(null);

  return {
    isSiteConfigFetching,
    siteConfig,

    // Branding
    appName, setAppName,
    appDescription, setAppDescription,
    faviconUrl, setFaviconUrl,
    appIconUrl, setAppIconUrl,
    loginIconUrl, setLoginIconUrl,
    characterIconUrl, setCharacterIconUrl,

    pendingFaviconFile, setPendingFaviconFile,
    pendingAppIconFile, setPendingAppIconFile,
    pendingLoginIconFile, setPendingLoginIconFile,
    pendingCharacterIconFile, setPendingCharacterIconFile,

    faviconObjectUrlRef,
    appIconObjectUrlRef,
    loginIconObjectUrlRef,
    characterIconObjectUrlRef,
    appDescriptionRef,

    // Theme (Derived from Cache + Optimistic Updates)
    theme,
    radius,
    density,
    primaryColor,

    // Actions
    updateTheme,
    updateRadius,
    updateDensity,
    updatePrimaryColor,
    handleDefaultSettingsSave,
    isSaving: isSavingSiteConfig,

    // Compatibility Shims (if any components still use setters)
    setTheme: updateTheme,
    setRadius: updateRadius,
    setDensity: updateDensity,
    setPrimaryColor: updatePrimaryColor,
  };
}