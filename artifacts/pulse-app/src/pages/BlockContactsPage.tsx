import { useState, useEffect, useMemo } from "react";
import { Capacitor } from "@capacitor/core";
// Requires `npm install @capacitor-community/contacts` and native
// permission entries — iOS: NSContactsUsageDescription in Info.plist;
// Android: READ_CONTACTS in AndroidManifest.xml — then `npx cap sync`.
// Not installed/configured yet as of this file's creation; the
// non-native (web) path below still works fully via manual entry only,
// so this doesn't need to block testing the rest of the flow.
import { Contacts } from "@capacitor-community/contacts";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { COUNTRY_CODES } from "@/lib/countryCodes";
import { Search, UserX, Phone, Plus, ShieldAlert, Check } from "lucide-react";

interface DeviceContact {
  id: string;
  name: string;
  /** Only the first phone number on the contact, if any — a contact
   *  picker that lets you choose which of several numbers to block per
   *  person would be more complete, but adds real UI complexity for a
   *  case (someone having multiple numbers AND you wanting to block a
   *  non-primary one) that's genuinely rare. The manual "add a number"
   *  flow below covers that edge case directly if it comes up. */
  rawPhoneNumber: string | null;
}

type PermissionState = "unknown" | "granted" | "denied" | "unavailable";

export default function BlockContactsPage() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [permissionState, setPermissionState] = useState<PermissionState>("unknown");
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Standalone "add a number not tied to any contact" flow.
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCountryCode, setManualCountryCode] = useState("+27");
  const [manualLocalNumber, setManualLocalNumber] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  // Per-contact "this person has no saved number — type one in" flow.
  const [numberEntryContactId, setNumberEntryContactId] = useState<string | null>(null);
  const [contactNumberOverrides, setContactNumberOverrides] = useState<Record<string, string>>({});

  const isNative = Capacitor.isNativePlatform();

  // Used to normalize local-format contact numbers (e.g. "082 123 4567")
  // that don't already start with "+" — see normalizeNumber below.
  const [userCountryCode, setUserCountryCode] = useState("+27");

  useEffect(() => {
    fetch("/api/phone/status", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const match = typeof body?.phone_number === "string" ? body.phone_number.match(/^\+\d{1,3}/) : null;
        if (match) {
          setUserCountryCode(match[0]);
          setManualCountryCode(match[0]);
        }
      })
      .catch(() => {});
  }, [token]);

  // Best-effort only: a number already in international format (+...)
  // is trusted as-is. Anything else is assumed to be in the CURRENT
  // USER's own country (via userCountryCode) — reasonable for most
  // contacts, but a number saved in local format for a different
  // country than the user's own will come out wrong. The normalized
  // result is shown next to each contact below rather than hidden, so
  // anything that looks off can be caught before confirming, instead of
  // silently blocking the wrong number.
  const normalizeNumber = (raw: string, countryCode: string): string | null => {
    const digitsAndPlus = raw.replace(/[^\d+]/g, "");
    if (digitsAndPlus.startsWith("+")) return digitsAndPlus.length >= 8 ? digitsAndPlus : null;
    const digitsOnly = digitsAndPlus.replace(/^0+/, "");
    if (digitsOnly.length < 7) return null;
    return `${countryCode}${digitsOnly}`;
  };

  const requestContactsAccess = async () => {
    if (!isNative) {
      setPermissionState("unavailable");
      return;
    }
    setIsLoadingContacts(true);
    try {
      const result = await Contacts.requestPermissions();
      if (result.contacts !== "granted") {
        setPermissionState("denied");
        return;
      }
      setPermissionState("granted");

      const { contacts: deviceContacts } = await Contacts.getContacts({
        projection: { name: true, phones: true },
      });

      const mapped: DeviceContact[] = deviceContacts
        .map((c) => ({
          id: c.contactId,
          name: c.name?.display?.trim() || "Unnamed contact",
          rawPhoneNumber: c.phones?.[0]?.number ?? null,
        }))
        // Contacts with neither a name nor a number aren't useful to
        // show at all.
        .filter((c) => c.name !== "Unnamed contact" || c.rawPhoneNumber);

      mapped.sort((a, b) => a.name.localeCompare(b.name));
      setContacts(mapped);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load contacts.",
        variant: "destructive",
      });
      setPermissionState("denied");
    } finally {
      setIsLoadingContacts(false);
    }
  };

  useEffect(() => {
    requestContactsAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || c.rawPhoneNumber?.includes(q));
  }, [contacts, searchQuery]);

  // Only contacts that ALREADY resolve to a usable number are eligible
  // for bulk select-all — someone with no saved number can't be bulk-
  // selected since there's nothing to block yet for them until a number
  // is typed in via the per-contact flow below. Scoped to whatever's
  // currently visible (respects an active search), matching how "select
  // all" behaves in most list UIs — it acts on what you're looking at,
  // not the entire underlying dataset regardless of filter.
  const selectableVisibleContacts = useMemo(
    () =>
      filteredContacts.filter((c) => {
        const raw = contactNumberOverrides[c.id] ?? c.rawPhoneNumber;
        return raw ? normalizeNumber(raw, userCountryCode) !== null : false;
      }),
    [filteredContacts, contactNumberOverrides, userCountryCode],
  );
  const allVisibleSelected =
    selectableVisibleContacts.length > 0 && selectableVisibleContacts.every((c) => selectedIds.has(c.id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const c of selectableVisibleContacts) next.delete(c.id);
      } else {
        for (const c of selectableVisibleContacts) next.add(c.id);
      }
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBlockSelected = async () => {
    const numbersToImport: string[] = [];
    for (const contact of contacts) {
      if (!selectedIds.has(contact.id)) continue;
      const raw = contactNumberOverrides[contact.id] ?? contact.rawPhoneNumber;
      if (!raw) continue;
      const normalized = normalizeNumber(raw, userCountryCode);
      if (normalized) numbersToImport.push(normalized);
    }

    if (numbersToImport.length === 0) {
      toast({ title: "Nothing to block", description: "None of the selected contacts have a usable number.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/blocked-contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone_numbers: numbersToImport }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to block contacts");
      toast({
        title: `Blocked ${body.imported ?? numbersToImport.length} contact${(body.imported ?? numbersToImport.length) === 1 ? "" : "s"}`,
        description: "They won't appear in your Discover or Search results.",
      });
      setSelectedIds(new Set());
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to block contacts.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualBlock = async () => {
    const normalized = normalizeNumber(manualLocalNumber, manualCountryCode);
    if (!normalized) {
      toast({ title: "Error", description: "Please enter a valid phone number", variant: "destructive" });
      return;
    }
    setIsSubmittingManual(true);
    try {
      const res = await fetch("/api/blocked-contacts/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone_number: normalized }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to block number");
      toast({ title: "Number blocked", description: "It won't appear in your Discover or Search results." });
      setManualLocalNumber("");
      setShowManualEntry(false);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to block number.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingManual(false);
    }
  };

  const handleSaveContactNumber = (contactId: string, value: string) => {
    setContactNumberOverrides((prev) => ({ ...prev, [contactId]: value }));
    setNumberEntryContactId(null);
    // Selecting the contact automatically once they have a usable
    // number — the whole point of typing it in was to block them.
    setSelectedIds((prev) => new Set(prev).add(contactId));
  };

  return (
    <div className="min-h-full px-6 pb-24 pt-6 bg-background">
      <PageHeader title="Block Contacts" backTo="/settings" />

      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          People you block here are hidden from your Discover and Search — they won't know, and it doesn't affect anyone you've already matched with.
        </p>

        {/* Standalone manual entry — for a number not saved as a device
            contact at all. */}
        <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
          <button onClick={() => setShowManualEntry((v) => !v)} className="w-full flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Plus size={18} className="text-muted-foreground" />
              <p className="text-sm font-medium">Add a number manually</p>
            </div>
          </button>
          {showManualEntry && (
            <div className="border-t border-border p-4 space-y-3">
              <div className="flex gap-2">
                <select
                  value={manualCountryCode}
                  onChange={(e) => setManualCountryCode(e.target.value)}
                  className="bg-background border border-card-border h-11 rounded-xl px-2 text-sm w-[104px] shrink-0"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={`${c.code}-${c.label}`} value={c.code}>
                      {c.label} {c.code}
                    </option>
                  ))}
                </select>
                <Input
                  type="tel"
                  inputMode="numeric"
                  value={manualLocalNumber}
                  onChange={(e) => setManualLocalNumber(e.target.value.replace(/[^\d\s]/g, ""))}
                  placeholder="82 123 4567"
                  className="bg-background border-card-border h-11 rounded-xl flex-1"
                />
              </div>
              <Button
                onClick={handleManualBlock}
                disabled={!manualLocalNumber.trim() || isSubmittingManual}
                className="w-full h-11 rounded-xl bg-gradient-accent border-0"
              >
                {isSubmittingManual ? "Blocking..." : "Block Number"}
              </Button>
            </div>
          )}
        </div>

        {/* Device contacts section */}
        {!isNative && (
          <div className="flex items-start gap-2 p-4 rounded-2xl bg-secondary border border-card-border">
            <ShieldAlert size={16} className="text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Reading your contacts requires the Deeply mobile app. On web, you can still block numbers manually above.
            </p>
          </div>
        )}

        {isNative && permissionState === "denied" && (
          <div className="p-4 rounded-2xl bg-secondary border border-card-border space-y-3">
            <div className="flex items-start gap-2">
              <ShieldAlert size={16} className="text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Contacts access was denied. Enable it for Deeply in your device's Settings app to pick contacts to block, or add numbers manually above.
              </p>
            </div>
            <Button onClick={requestContactsAccess} variant="outline" className="w-full h-10 rounded-xl text-sm">
              Try Again
            </Button>
          </div>
        )}

        {isNative && permissionState === "granted" && (
          <>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search contacts"
                className="bg-card border-card-border h-11 rounded-xl pl-9"
              />
            </div>

            {!isLoadingContacts && selectableVisibleContacts.length > 0 && (
              <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm font-medium text-primary">
                <div
                  className={`w-5 h-5 rounded-md border shrink-0 flex items-center justify-center transition-colors ${
                    allVisibleSelected ? "bg-primary border-primary" : "border-card-border"
                  }`}
                >
                  {allVisibleSelected && <Check size={13} className="text-primary-foreground" />}
                </div>
                {allVisibleSelected
                  ? "Deselect All"
                  : `Select All${searchQuery ? " (matching search)" : ""} (${selectableVisibleContacts.length})`}
              </button>
            )}

            {isLoadingContacts ? (
              <p className="text-xs text-muted-foreground text-center py-6">Loading contacts...</p>
            ) : filteredContacts.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <UserX size={24} className="text-muted-foreground mb-2" />
                <p className="text-xs text-muted-foreground">
                  {searchQuery ? "No contacts match your search." : "No contacts found on this device."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredContacts.map((contact) => {
                  const overrideNumber = contactNumberOverrides[contact.id];
                  const effectiveRaw = overrideNumber ?? contact.rawPhoneNumber;
                  const normalized = effectiveRaw ? normalizeNumber(effectiveRaw, userCountryCode) : null;
                  const isSelected = selectedIds.has(contact.id);
                  const isEnteringNumber = numberEntryContactId === contact.id;

                  return (
                    <div key={contact.id} className="bg-card border border-card-border rounded-2xl p-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => (normalized ? toggleSelected(contact.id) : setNumberEntryContactId(contact.id))}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        >
                          <div
                            className={`w-5 h-5 rounded-md border shrink-0 flex items-center justify-center transition-colors ${
                              isSelected ? "bg-primary border-primary" : "border-card-border"
                            }`}
                          >
                            {isSelected && <Check size={13} className="text-primary-foreground" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{contact.name}</p>
                            {normalized ? (
                              <p className="text-xs text-muted-foreground truncate">{normalized}</p>
                            ) : (
                              <p className="text-xs text-primary">No number saved — tap to add</p>
                            )}
                          </div>
                        </button>
                        {!normalized && !isEnteringNumber && (
                          <Phone size={16} className="text-muted-foreground shrink-0" />
                        )}
                      </div>

                      {isEnteringNumber && (
                        <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                          <select
                            value={userCountryCode}
                            onChange={(e) => setUserCountryCode(e.target.value)}
                            className="bg-background border border-card-border h-10 rounded-lg px-2 text-xs w-[92px] shrink-0"
                          >
                            {COUNTRY_CODES.map((c) => (
                              <option key={`${c.code}-${c.label}`} value={c.code}>
                                {c.code}
                              </option>
                            ))}
                          </select>
                          <Input
                            autoFocus
                            type="tel"
                            inputMode="numeric"
                            placeholder="82 123 4567"
                            className="bg-background border-card-border h-10 rounded-lg flex-1 text-sm"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveContactNumber(contact.id, (e.target as HTMLInputElement).value);
                            }}
                            onBlur={(e) => {
                              if (e.target.value.trim()) handleSaveContactNumber(contact.id, e.target.value);
                              else setNumberEntryContactId(null);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {selectedIds.size > 0 && (
        // Positioned ABOVE the app's BottomNav rather than at bottom-0
        // like it — BottomNav (see BottomNav.tsx) is itself `fixed
        // bottom-0` with `z-50`, so a second bottom-0 element with no
        // z-index of its own renders directly underneath it in the
        // stacking order, not visibly on top — exactly the "button
        // hidden behind the nav" symptom. bottom-20 (5rem/80px) clears
        // the nav's own height (py-4 padding + a 22px icon + label
        // text) with a bit of headroom; z-40 keeps this deliberately
        // just below the nav's own z-50, since once they're vertically
        // separated stacking order between them no longer matters, but
        // it should still stay above ordinary page content. Matches
        // BottomNav's own max-w-[430px] mx-auto so it lines up with the
        // rest of the app's mobile-width container instead of
        // stretching full browser width on desktop.
        <div className="fixed bottom-20 left-0 right-0 z-40 px-6">
          <div className="max-w-[430px] mx-auto">
            <Button
              onClick={handleBlockSelected}
              disabled={isSubmitting}
              className="w-full h-14 rounded-xl text-lg font-semibold bg-gradient-accent border-0 shadow-[0_4px_20px_rgba(225,29,72,0.3)]"
            >
              {isSubmitting ? "Blocking..." : `Block ${selectedIds.size} Selected`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
