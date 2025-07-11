
import { useState, useEffect } from "react"
import { TurboFactory, ArconnectSigner } from "@ardrive/turbo-sdk/web"
import { Pool } from "../types/types"
import { isValidArweaveAddress } from "../utils/utils"
import { useUser } from "./useUser"

export function usePoolManager(
  setShowPoolActions: (value: boolean) => void,
  setShowCreateModal: (value: boolean) => void,
  setShowEditModal: (value: boolean) => void,
  toastFunctions: {
    showSuccess: (title: string, message: string) => void
    showError: (title: string, message: string) => void
    showWarning: (title: string, message: string) => void
    showInfo: (title: string, message: string) => void
  }
) {
  const [pools, setPools] = useState<Pool[]>([])
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)
  const [totalPools, setTotalPools] = useState(0)
  const [activePools, setActivePools] = useState(0)
  const [showTerminal, setShowTerminal] = useState(false)
  const [terminalStatus, setTerminalStatus] = useState<string>('')
  const [terminalActionType, setTerminalActionType] = useState<'sponsor' | 'revoke' | null>(null)
  const [terminalResult, setTerminalResult] = useState<string | null>(null)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [terminalRawOutput, setTerminalRawOutput] = useState<any[]>([])
  const { connected, address } = useUser()
  const { showSuccess, showError, showWarning } = toastFunctions

  useEffect(() => {
    if (connected && address) {
      loadPools()
    } else {
      setPools([])
      setTotalPools(0)
      setActivePools(0)
      setSelectedPool(null)
      setShowPoolActions(false)
    }
  }, [connected, address])

  const loadPools = async () => {
    const storedPools = localStorage.getItem("pools")
    const poolData: { [key: string]: Omit<Pool, "id" | "status" | "poolId" | "balance"> } = storedPools ? JSON.parse(storedPools) : {}
    let poolArray: Pool[] = Object.entries(poolData).map(([id, pool]) => ({
      ...pool,
      id,
      status: new Date() < new Date(pool.endTime) ? "Active" : "Ended",
      balance: null,
      poolId: id,
      sponsoredAddresses: pool.sponsoredAddresses || [],
      expireBySeconds: pool.expireBySeconds ?? null,
    }))

    // Fetch balance for each pool if connected
    if (connected && address && window.arweaveWallet) {
      try {
        const signer = new ArconnectSigner(window.arweaveWallet)
        const turbo = TurboFactory.authenticated({
          signer,
          token: "arweave",
        })
        const balanceResult = await turbo.getBalance()
        const balance = Number(balanceResult.winc) / 1e12 // Convert winston to Turbo Credits
        poolArray = poolArray.map(pool => ({ ...pool, balance }))
      } catch (error) {
        showError("Balance Check Failed", `Failed to fetch balance: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    setPools(poolArray)
    setTotalPools(poolArray.length)
    setActivePools(poolArray.filter((pool) => pool.status === "Active").length)
    if (selectedPool) {
      const updatedSelectedPool = poolArray.find((pool) => pool.id === selectedPool.id)
      if (updatedSelectedPool) {
        setSelectedPool(updatedSelectedPool)
      }
    }
  }

  const savePools = (updatedPools: Pool[]) => {
    // Clear existing pool data to prevent stale entries
    localStorage.removeItem("pools")
    const poolObject = updatedPools.reduce((acc, pool) => {
      acc[pool.id] = {
        name: pool.name,
        startTime: pool.startTime,
        endTime: pool.endTime,
        usageCap: pool.usageCap,
        addresses: pool.addresses,
        sponsoredAddresses: pool.sponsoredAddresses,
        sponsorInfo: pool.sponsorInfo,
        expireBySeconds: pool.expireBySeconds,
      }
      return acc
    }, {} as { [key: string]: Omit<Pool, "id" | "status" | "poolId" | "balance"> })
    localStorage.setItem("pools", JSON.stringify(poolObject))
    setPools(updatedPools)
    setTotalPools(updatedPools.length)
    setActivePools(updatedPools.filter((pool) => pool.status === "Active").length)
  }

  const fetchBalance = async (): Promise<number | null> => {
    if (!connected || !window.arweaveWallet) {
      showError("Wallet Error", "Please connect your wallet first")
      return null
    }
    try {
      const signer = new ArconnectSigner(window.arweaveWallet)
      const turbo = TurboFactory.authenticated({
        signer,
        token: "arweave",
      })
      const balanceResult = await turbo.getBalance()
      return Number(balanceResult.winc) / 1e12 // Convert winston to Turbo Credits
    } catch (error) {
      showError("Balance Check Failed", `Failed to fetch balance: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  const handleRefreshBalance = async () => {
    if (!selectedPool) {
      showError("No Pool Selected", "Please select a pool first")
      return null
    }
    const balance = await fetchBalance()
    if (balance !== null) {
      const updatedPool = { ...selectedPool, balance }
      const updatedPools = pools.map((p) => (p.id === selectedPool.id ? updatedPool : p))
      setPools(updatedPools)
      setSelectedPool(updatedPool)
      showSuccess("Balance Refreshed", `Balance for pool "${selectedPool.name}" has been updated`)
      return balance
    }
    return null
  }

  const handleCreatePool = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!connected || !address) {
      showError("Wallet Error", "Please connect your wallet first")
      return
    }
    const formData = new FormData(e.target as HTMLFormElement)
    const poolName = formData.get("poolName") as string
    const startTime = formData.get("startTime") as string
    const endTime = formData.get("endTime") as string
    const usageCap = Number.parseFloat(formData.get("usageCap") as string)
    const addresses = (formData.get("addresses") as string)
      .split("\n")
      .map((a) => a.trim())
      .filter((a) => a)

    if (!poolName.trim()) return showError("Invalid Pool Name", "Please enter a valid pool name")
    const invalidAddresses = addresses.filter((a) => !isValidArweaveAddress(a))
    if (invalidAddresses.length > 0)
      return showError("Invalid Addresses", `Please fix invalid addresses: ${invalidAddresses.join(", ")}`)
    const startDateTime = new Date(startTime)
    const endDateTime = new Date(endTime)
    if (startDateTime >= endDateTime) return showError("Invalid Dates", "Start time must be before end time")

    const poolId = crypto.randomUUID()
    const newPool: Pool = {
      id: poolId,
      name: poolName,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      usageCap,
      addresses,
      sponsoredAddresses: [],
      balance: await fetchBalance(),
      status: "Active",
      poolId: poolId,
      sponsorInfo: "",
      expireBySeconds: Math.floor((new Date(endTime).getTime() - Date.now()) / 1000),
    }

    const updatedPools = [...pools, newPool]
    savePools(updatedPools)
    setShowCreateModal(false)
    showSuccess("Pool Created", `Pool "${poolName}" has been created successfully`)
  }

  const handleEditPool = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedPool) return showError("No Pool Selected", "Please select a pool to edit")
    const formData = new FormData(e.target as HTMLFormElement)
    const poolName = formData.get("poolName") as string
    const startTime = formData.get("startTime") as string
    const endTime = formData.get("endTime") as string
    const usageCap = Number.parseFloat(formData.get("usageCap") as string)
    const addresses = (formData.get("addresses") as string)
      .split("\n")
      .map((a) => a.trim())
      .filter((a) => a)

    if (!poolName.trim()) return showError("Invalid Pool Name", "Please enter a valid pool name")
    if (Number.isNaN(usageCap) || usageCap < 0) return showError("Invalid Usage Cap", "Please enter a valid usage cap")
    const invalidAddresses = addresses.filter((a) => !isValidArweaveAddress(a))
    if (invalidAddresses.length > 0)
      return showError("Invalid Addresses", `Please fix invalid addresses: ${invalidAddresses.join(", ")}`)
    const startDateTime = new Date(startTime)
    const endDateTime = new Date(endTime)
    if (startDateTime >= endDateTime) return showError("Invalid Dates", "Start time must be before end time")

    try {
      const balance = await fetchBalance()
      const updatedPool: Pool = {
        ...selectedPool,
        name: poolName,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        usageCap,
        addresses,
        sponsoredAddresses: selectedPool.sponsoredAddresses,
        balance,
        expireBySeconds: Math.floor((new Date(endTime).getTime() - Date.now()) / 1000),
      }

      const updatedPools = pools.map((pool) => (pool.id === selectedPool.id ? updatedPool : pool))
      savePools(updatedPools)
      setSelectedPool(updatedPool)
      showSuccess("Pool Updated", `Pool "${poolName}" has been updated successfully`)
      setShowEditModal(false)
    } catch (error) {
      showError("Edit Failed", `Failed to update pool: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleDeletePool = async () => {
    if (!selectedPool) return showError("No Pool Selected", "Please select a pool to delete")
    const confirmDelete = window.confirm("Are you sure you want to delete this pool? This action cannot be undone.")
    if (!confirmDelete) return

    const updatedPools = pools.filter((pool) => pool.id !== selectedPool.id)
    savePools(updatedPools)
    setSelectedPool(null)
    setShowPoolActions(false)
    showSuccess("Pool Deleted", `Pool "${selectedPool.name}" has been deleted successfully`)
  }

  const handleRevokeAccess = async (revokeAddress: string) => {
    if (!revokeAddress.trim()) return showError("Invalid Address", "Please enter a valid wallet address")
    if (!isValidArweaveAddress(revokeAddress))
      return showError("Invalid Address", "Please enter a valid Arweave address")
    if (!selectedPool) return showError("No Pool Selected", "Please select a pool first")
    if (!connected || !window.arweaveWallet) {
      showError("Wallet Error", "Please connect your wallet first")
      return
    }

    setShowTerminal(true)
    setTerminalActionType('revoke')
    setTerminalStatus(`Revoking access for ${revokeAddress.slice(0, 10)}...`)
    setTerminalRawOutput([])

    try {
      const signer = new ArconnectSigner(window.arweaveWallet)
      const turbo = TurboFactory.authenticated({
        signer,
        token: "arweave",
      })
      const response = await turbo.revokeCredits({ revokedAddress: revokeAddress })
      setTerminalRawOutput([{ address: revokeAddress, response }])

      // Update pool state by removing the revoked address from both addresses and sponsoredAddresses
      const updatedPool: Pool = {
        ...selectedPool,
        addresses: selectedPool.addresses.filter((addr) => addr !== revokeAddress),
        sponsoredAddresses: selectedPool.sponsoredAddresses.filter((addr) => addr !== revokeAddress),
      }

      // Verify address removal
      if (updatedPool.addresses.includes(revokeAddress)) {
        throw new Error(`Failed to remove ${revokeAddress} from whitelisted addresses`)
      }
      if (updatedPool.sponsoredAddresses.includes(revokeAddress)) {
        throw new Error(`Failed to remove ${revokeAddress} from sponsored addresses`)
      }

      const updatedPools = pools.map((pool) => (pool.id === selectedPool.id ? updatedPool : pool))
      savePools(updatedPools)
      setSelectedPool(updatedPool)
      await loadPools() // Refresh pool data
      setTerminalResult(revokeAddress)
      setTerminalError(null)
      showSuccess("Access Revoked", `Successfully revoked access for ${revokeAddress.slice(0, 10)}...`)
    } catch (error) {
      const errorMessage = `Error revoking access: ${error instanceof Error ? error.message : String(error)}`
      setTerminalError(errorMessage)
      setTerminalResult(null)
      setTerminalRawOutput([])
      showError("Revoke Failed", errorMessage)
    } finally {
      setTerminalStatus('')
      setShowTerminal(true)
    }
  }

  const handleSponsorCredits = async () => {
    if (!selectedPool) {
      showError("No Pool Selected", "Please select a pool first")
      return
    }
    if (!connected || !window.arweaveWallet) {
      showError("Wallet Error", "Please connect your wallet first")
      return
    }

    // Check for unsponsored addresses
    let unsponsoredAddresses = selectedPool.addresses.filter(
      (addr) => !selectedPool.sponsoredAddresses.includes(addr)
    )
    console.log("Sponsored Addresses:", selectedPool.sponsoredAddresses)
    console.log("Unsponsored Addresses:", unsponsoredAddresses)
    if (unsponsoredAddresses.length === 0) {
      showError("No Addresses", "All whitelisted addresses have already been sponsored")
      return
    }

    setShowTerminal(true)
    setTerminalActionType('sponsor')
    setTerminalStatus(`Sponsoring credits for ${unsponsoredAddresses.length} addresses...`)
    setTerminalRawOutput([])

    try {
      const signer = new ArconnectSigner(window.arweaveWallet)
      const turbo = TurboFactory.authenticated({
        signer,
        token: "arweave",
      })
      const balanceResp = await turbo.getBalance()
      const availableCredits = Number(balanceResp.winc) / 1e12
      const usageCapCredits = selectedPool.usageCap
      const creditsPerAddress = Math.min(usageCapCredits, availableCredits / unsponsoredAddresses.length)
      const creditsPerAddressWinston = BigInt(Math.floor(creditsPerAddress * 1e12))

      if (creditsPerAddressWinston <= 0n) {
        setTerminalError("Not enough credits available to sponsor")
        setTerminalResult(null)
        showError("Insufficient Credits", "Not enough credits available to sponsor")
        return
      }

      // Calculate expireBySeconds based on endTime
      const endTime = new Date(selectedPool.endTime)
      const currentTime = new Date()
      const secondsUntilEnd = Math.floor((endTime.getTime() - currentTime.getTime()) / 1000)
      if (secondsUntilEnd <= 0) {
        setTerminalError("Pool has already ended")
        setTerminalResult(null)
        showError("Pool Ended", "Cannot sponsor credits for an ended pool")
        return
      }

      let successfulShares = 0
      const errors: string[] = []
      const rawOutputs: any[] = []
      let currentSponsoredAddresses = [...selectedPool.sponsoredAddresses]

      // Process each address sequentially to avoid race conditions
      for (const addr of unsponsoredAddresses) {
        // Re-check if address is already sponsored to handle any state inconsistencies
        if (currentSponsoredAddresses.includes(addr)) {
          console.log(`Skipping already sponsored address: ${addr}`)
          continue
        }

        setTerminalStatus(`Sponsoring credits for ${addr.slice(0, 10)}...`)
        try {
          const response = await turbo.shareCredits({
            approvedAddress: addr,
            approvedWincAmount: creditsPerAddressWinston.toString(),
            expiresBySeconds: secondsUntilEnd,
          })
          rawOutputs.push({ address: addr, response })

          // Update sponsored addresses
          currentSponsoredAddresses = [...currentSponsoredAddresses, addr]

          // Update pool state immediately
          const updatedPool = {
            ...selectedPool,
            sponsoredAddresses: currentSponsoredAddresses,
            expireBySeconds: secondsUntilEnd,
          }

          // Update pools state and persist to localStorage
          const updatedPools = pools.map((p) => (p.id === selectedPool.id ? updatedPool : p))
          savePools(updatedPools)
          setSelectedPool(updatedPool)

          successfulShares++
        } catch (error) {
          const errorMsg = `Failed to sponsor credits for ${addr.slice(0, 10)}...: ${error instanceof Error ? error.message : String(error)}`
          console.error(errorMsg)
          errors.push(errorMsg)
        }
      }
      setTerminalRawOutput(rawOutputs)

      // Refresh pool data after sponsorship
      await loadPools()

      if (successfulShares > 0) {
        const message = `Successfully sponsored up to ${creditsPerAddress.toFixed(4)} credits to ${successfulShares} of ${unsponsoredAddresses.length} addresses`
        setTerminalResult(message)
        setTerminalError(null)
        if (errors.length > 0) {
          setTerminalError(errors.join("; "))
          showWarning("Partial Success", `${message}. Errors: ${errors.join("; ")}`)
        } else {
          showSuccess("Credits Sponsored", message)
        }
      } else {
        setTerminalError(errors.length > 0 ? `Errors: ${errors.join("; ")}` : "No credits sponsored.")
        setTerminalResult(null)
        showError("Sponsor Failed", errors.length > 0 ? `Errors: ${errors.join("; ")}` : "No credits sponsored.")
      }
    } catch (error) {
      const errorMessage = `Error sponsoring credits: ${error instanceof Error ? error.message : String(error)}`
      setTerminalError(errorMessage)
      setTerminalResult(null)
      showError("Sponsor Failed", errorMessage)
    } finally {
      setTerminalStatus('')
      setShowTerminal(true)
    }
  }

  const handleTerminalClose = () => {
    setShowTerminal(false)
    setTerminalActionType(null)
    setTerminalResult(null)
    setTerminalError(null)
    setTerminalRawOutput([])
  }

  return {
    pools,
    selectedPool,
    setSelectedPool,
    totalPools,
    setTotalPools,
    activePools,
    setActivePools,
    fetchBalance,
    loadPools,
    handleCreatePool,
    handleEditPool,
    handleDeletePool,
    handleRevokeAccess,
    handleSponsorCredits,
    handleRefreshBalance,
    showTerminal,
    terminalStatus,
    terminalActionType,
    terminalResult,
    terminalError,
    terminalRawOutput,
    handleTerminalClose,
  }
}
