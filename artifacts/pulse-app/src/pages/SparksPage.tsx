import { useGetSparks, useGetSparksBundles, useGetSparksHistory, useClaimDailyEarn, usePurchaseSparks, getGetSparksQueryKey } from "@workspace/api-client-react";
import { SparkIcon } from "@/components/Icons";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Zap, Calendar, UserCheck, Star } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function SparksPage() {
  const { data: sparks, isLoading: sparksLoading } = useGetSparks();
  const { data: bundles, isLoading: bundlesLoading } = useGetSparksBundles();
  const { data: history, isLoading: historyLoading } = useGetSparksHistory();
  
  const claimEarn = useClaimDailyEarn();
  const purchase = usePurchaseSparks();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleClaim = (type: string) => {
    claimEarn.mutate({ data: { claim_type: type } }, {
      onSuccess: () => {
        toast({ title: "Claimed!", description: "Sparks added to your balance." });
        queryClient.invalidateQueries({ queryKey: getGetSparksQueryKey() });
      }
    });
  };

  const handlePurchase = (bundleId: string) => {
    purchase.mutate({ data: { bundle_id: bundleId } }, {
      onSuccess: () => {
        toast({ title: "Purchase successful", description: "Your balance has been updated." });
        queryClient.invalidateQueries({ queryKey: getGetSparksQueryKey() });
      }
    });
  };

  const isLoading = sparksLoading || bundlesLoading;

  if (isLoading) {
    return <div className="p-6 pt-12"><Skeleton className="h-40 w-full rounded-3xl mb-8" /><Skeleton className="h-64 w-full rounded-3xl" /></div>;
  }

  return (
    <div className="min-h-full pb-6 bg-background">
      {/* Hero Balance */}
      <div className="bg-card border-b border-card-border px-6 pt-16 pb-10 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[250px] h-[250px] bg-primary/20 blur-[100px] rounded-full pointer-events-none translate-x-1/3 -translate-y-1/3" />
        
        <div className="relative z-10 flex flex-col items-center">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Your Balance</p>
          <div className="flex items-center justify-center gap-3">
            <SparkIcon size={48} className="text-primary drop-shadow-[0_0_15px_rgba(192,38,211,0.5)]" />
            <span className="text-7xl font-['Syne'] font-extrabold text-foreground tracking-tighter">
              {sparks?.balance || 0}
            </span>
          </div>
          
          <div className="flex items-center gap-6 mt-8 w-full max-w-[280px]">
            <div className="flex-1 flex flex-col items-center p-3 bg-secondary/50 rounded-2xl border border-border">
              <span className="text-xl font-['Syne'] font-bold text-green-500">+{sparks?.earned_this_week || 0}</span>
              <span className="text-[10px] text-muted-foreground uppercase mt-1">Earned / Wk</span>
            </div>
            <div className="flex-1 flex flex-col items-center p-3 bg-secondary/50 rounded-2xl border border-border">
              <span className="text-xl font-['Syne'] font-bold text-muted-foreground">-{sparks?.spent_this_week || 0}</span>
              <span className="text-[10px] text-muted-foreground uppercase mt-1">Spent / Wk</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-10">
        
        {/* Daily Earn */}
        <section>
          <h2 className="text-lg font-['Syne'] font-bold mb-4 flex items-center gap-2">
            <Zap size={18} className="text-primary" /> Earn Sparks
          </h2>
          <div className="space-y-3">
            {sparks?.daily_earn_available?.map((option, idx) => (
              <motion.div 
                key={option.type}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="flex items-center justify-between p-4 bg-card border border-card-border rounded-2xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-foreground">
                    {option.type === 'daily_login' ? <Calendar size={18} /> : 
                     option.type === 'profile_complete' ? <UserCheck size={18} /> : 
                     <Star size={18} />}
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">{option.label}</h4>
                    <p className="text-xs text-primary font-bold">+{option.amount} Sparks</p>
                  </div>
                </div>
                <Button 
                  size="sm" 
                  className={`rounded-full h-8 px-4 text-xs font-bold ${option.claimed ? 'bg-secondary text-muted-foreground' : 'bg-primary hover:bg-primary/90 text-white'}`}
                  disabled={option.claimed || claimEarn.isPending}
                  onClick={() => handleClaim(option.type)}
                >
                  {option.claimed ? "Claimed" : "Claim"}
                </Button>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Store */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-['Syne'] font-bold text-foreground">Buy Sparks</h2>
            <p className="text-sm text-muted-foreground">No auto-renewal. Ever. Pay for what you use.</p>
          </div>
          
          <div className="grid grid-cols-1 gap-4">
            {bundles?.map(bundle => {
              const isPopular = bundle.label?.includes("Value") || bundle.label?.includes("Popular");
              return (
                <div 
                  key={bundle.id} 
                  className={`relative p-5 rounded-3xl border flex items-center justify-between transition-transform active:scale-[0.98] ${
                    isPopular 
                      ? 'bg-gradient-to-br from-card to-card border-primary shadow-[0_0_20px_rgba(192,38,211,0.15)] overflow-hidden' 
                      : 'bg-card border-card-border hover:border-primary/50'
                  }`}
                >
                  {isPopular && (
                     <div className="absolute top-0 right-0 bg-primary text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl tracking-wider uppercase">
                       {bundle.label}
                     </div>
                  )}
                  
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5 font-['Syne'] text-2xl font-bold">
                      <SparkIcon size={20} className={isPopular ? "text-primary" : "text-foreground"} />
                      {bundle.sparks}
                    </div>
                    <span className="text-sm text-muted-foreground font-medium mt-0.5">{bundle.name}</span>
                  </div>
                  
                  <Button 
                    className={`rounded-xl px-6 h-12 font-bold text-base border-0 ${
                      isPopular 
                        ? 'bg-gradient-accent text-white shadow-lg' 
                        : 'bg-secondary text-foreground hover:bg-secondary/80'
                    }`}
                    onClick={() => handlePurchase(bundle.id)}
                    disabled={purchase.isPending}
                  >
                    ${bundle.price_usd}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
