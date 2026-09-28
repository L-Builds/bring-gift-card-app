import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { LEGAL_DOCUMENTS, type LegalDocument, type LegalKind } from "@/src/legal/documents";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { ScreenBackground } from "@/src/components/ui";
import { StackHeader } from "@/src/components/stack-header";

type Block = { type: "paragraph" | "bullet"; text: string };
type Section = { title: string; blocks: Block[] };

function normalizeKind(value: string | string[] | undefined): LegalKind {
  return value === "privacy" ? "privacy" : "terms";
}

function parseDocument(content: string): Section[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text && current) current.blocks.push({ type: "paragraph", text });
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      flushParagraph();
      current = { title: line.slice(3).trim(), blocks: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      if (line) {
        current = { title: "Overview", blocks: [] };
        sections.push(current);
      } else continue;
    }
    if (!line) {
      flushParagraph();
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      current.blocks.push({ type: "bullet", text: line.slice(2).trim() });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return sections;
}

function sectionNumber(title: string, index: number) {
  const match = title.match(/^(\d+)\.\s*/);
  return match?.[1] ?? String(index + 1);
}

function cleanTitle(title: string) {
  return title.replace(/^\d+\.\s*/, "");
}

export default function LegalScreen() {
  const { kind: rawKind } = useLocalSearchParams<{ kind?: string }>();
  const kind = normalizeKind(rawKind);
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const fallback = LEGAL_DOCUMENTS[kind];
  const q = useQuery({
    queryKey: ["legal", kind],
    queryFn: () => api.get<LegalDocument>(`/legal/${kind}`, false),
    staleTime: 5 * 60 * 1000,
  });
  const doc = q.data ?? fallback;
  const sections = useMemo(() => parseDocument(doc.content || fallback.content), [doc.content, fallback.content]);
  const overview = sections[0];
  const body = sections.slice(1);
  const isTerms = kind === "terms";

  return (
    <ScreenBackground>
      <StackHeader title="Legal" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        testID={`legal-${kind}`}
      >
        <View style={styles.switcher}>
          <Pressable
            onPress={() => router.replace("/legal/terms")}
            style={[styles.switchBtn, isTerms && styles.switchActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: isTerms }}
          >
            <Ionicons name="document-text-outline" size={17} color={isTerms ? colors.onBrandPrimary : colors.muted} />
            <Text style={[styles.switchText, isTerms && styles.switchTextActive]}>Terms</Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace("/legal/privacy")}
            style={[styles.switchBtn, !isTerms && styles.switchActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: !isTerms }}
          >
            <Ionicons name="shield-checkmark-outline" size={17} color={!isTerms ? colors.onBrandPrimary : colors.muted} />
            <Text style={[styles.switchText, !isTerms && styles.switchTextActive]}>Privacy</Text>
          </Pressable>
        </View>

        <LinearGradient
          colors={[colors.brandDeep, colors.brandPrimary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroIcon}>
            <Ionicons name={isTerms ? "document-text" : "shield-checkmark"} size={28} color={colors.brandPrimary} />
          </View>
          <Text style={styles.eyebrow}>BRING GIFT CARD LEGAL</Text>
          <Text style={styles.heroTitle}>{doc.title}</Text>
          <Text style={styles.heroBody}>
            {isTerms
              ? "Clear rules for accounts, gift-card trades, reviews, wallet balances, withdrawals, and using Bring Gift Card responsibly."
              : "A clear explanation of what information Bring Gift Card uses, why we use it, how it is protected, and the choices available to you."}
          </Text>
          <View style={styles.metaRow}>
            <View style={styles.metaPill}><Text style={styles.metaText}>Effective {doc.effective_date || fallback.effective_date}</Text></View>
            <View style={styles.metaPill}><Text style={styles.metaText}>Version {doc.version || fallback.version}.0</Text></View>
          </View>
          <Text style={styles.updated}>Last updated {doc.last_updated || fallback.last_updated}</Text>
        </LinearGradient>

        {q.isError && (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color={colors.info} />
            <Text style={styles.noticeText}>Showing the built-in legal copy while the live document refreshes.</Text>
          </View>
        )}

        {overview && (
          <View style={styles.overviewCard}>
            <View style={styles.cardHead}>
              <View style={styles.cardIcon}><Ionicons name="sparkles" size={19} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardEyebrow}>{isTerms ? "QUICK OVERVIEW" : "PRIVACY AT A GLANCE"}</Text>
                <Text style={styles.cardTitle}>The important points first</Text>
              </View>
            </View>
            <View style={styles.summaryList}>
              {overview.blocks.map((block, index) => (
                <View key={`${block.type}-${index}`} style={block.type === "bullet" ? styles.summaryRow : undefined}>
                  {block.type === "bullet" && <View style={styles.dot}><Ionicons name="checkmark" size={12} color={colors.onBrandPrimary} /></View>}
                  <Text style={block.type === "bullet" ? styles.summaryText : styles.paragraph}>{block.text}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.contentsCard}>
          <View style={styles.cardHead}>
            <View style={styles.cardIcon}><Ionicons name="list" size={19} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardEyebrow}>DOCUMENT STRUCTURE</Text>
              <Text style={styles.cardTitle}>What this document covers</Text>
            </View>
          </View>
          <View style={styles.contentsGrid}>
            {body.map((section, index) => (
              <View key={section.title} style={styles.contentsItem}>
                <Text style={styles.contentsNo}>{sectionNumber(section.title, index)}</Text>
                <Text style={styles.contentsText}>{cleanTitle(section.title)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.sectionStack}>
          {body.map((section, index) => (
            <View key={section.title} style={styles.sectionCard}>
              <View style={styles.sectionHeading}>
                <View style={styles.numberBadge}>
                  <Text style={styles.numberText}>{sectionNumber(section.title, index)}</Text>
                </View>
                <Text style={styles.sectionTitle}>{cleanTitle(section.title)}</Text>
              </View>
              <View style={styles.sectionBody}>
                {section.blocks.map((block, blockIndex) => block.type === "bullet" ? (
                  <View key={blockIndex} style={styles.bulletRow}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.bodyText}>{block.text}</Text>
                  </View>
                ) : (
                  <Text key={blockIndex} style={styles.bodyText}>{block.text}</Text>
                ))}
              </View>
            </View>
          ))}
        </View>

        <View style={styles.helpCard}>
          <View style={styles.helpIcon}><Ionicons name="headset-outline" size={22} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.helpTitle}>Questions or concerns?</Text>
            <Text style={styles.helpBody}>Use Help & Support in Bring Gift Card and our team can review your question or request.</Text>
          </View>
          <Pressable onPress={() => router.push("/support")} style={styles.helpButton}>
            <Ionicons name="arrow-forward" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>

        <Text style={styles.footerText}>Bring Gift Card · {doc.title} · Version {doc.version || fallback.version}.0</Text>
      </ScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl * 2, gap: spacing.lg },
  switcher: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4, gap: 4, shadowColor: colors.shadow, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  switchBtn: { flex: 1, height: 42, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  switchActive: { backgroundColor: colors.brandPrimary },
  switchText: { color: colors.muted, fontWeight: "800", fontSize: 13.5 },
  switchTextActive: { color: colors.onBrandPrimary },
  hero: { borderRadius: radius.xxl, padding: spacing.xxl, overflow: "hidden", shadowColor: colors.brandDeep, shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 4 },
  heroIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  eyebrow: { color: "rgba(255,255,255,0.72)", fontSize: 11, letterSpacing: 1.25, fontWeight: "800" },
  heroTitle: { color: colors.onBrandPrimary, fontSize: 29, lineHeight: 34, fontWeight: "900", marginTop: 5 },
  heroBody: { color: "rgba(255,255,255,0.9)", fontSize: 14, lineHeight: 21, marginTop: spacing.md, maxWidth: 620 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.lg },
  metaPill: { backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 7 },
  metaText: { color: colors.onBrandPrimary, fontSize: 11.5, fontWeight: "700" },
  updated: { color: "rgba(255,255,255,0.68)", fontSize: 11.5, marginTop: spacing.sm },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.infoBg, borderRadius: radius.lg, padding: spacing.md },
  noticeText: { flex: 1, color: colors.info, fontSize: 12.5, lineHeight: 18 },
  overviewCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, shadowColor: colors.shadow, shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 1 },
  contentsCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.lg },
  cardIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  cardEyebrow: { color: colors.brandPrimary, fontSize: 10.5, letterSpacing: 0.9, fontWeight: "900" },
  cardTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "900", marginTop: 2 },
  summaryList: { gap: spacing.md },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: 1 },
  summaryText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 20 },
  paragraph: { color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 20 },
  contentsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  contentsItem: { width: "48%", minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  contentsNo: { width: 22, color: colors.brandPrimary, fontSize: 11.5, fontWeight: "900" },
  contentsText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 11.5, lineHeight: 15, fontWeight: "700" },
  sectionStack: { gap: spacing.md },
  sectionCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.divider },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  numberBadge: { minWidth: 38, height: 38, borderRadius: 12, paddingHorizontal: 9, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  numberText: { color: colors.brandPrimary, fontSize: 13, fontWeight: "900" },
  sectionTitle: { flex: 1, color: colors.onSurface, fontSize: 16, lineHeight: 21, fontWeight: "900" },
  sectionBody: { gap: spacing.md, marginTop: spacing.lg },
  bodyText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 21 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary, marginTop: 7 },
  helpCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandSecondary, borderRadius: radius.xl, padding: spacing.lg },
  helpIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  helpTitle: { color: colors.onSurface, fontSize: 14.5, fontWeight: "900" },
  helpBody: { color: colors.onSurfaceSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  helpButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  footerText: { color: colors.muted, fontSize: 11.5, textAlign: "center", paddingVertical: spacing.sm },
}));
