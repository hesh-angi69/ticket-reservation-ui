package com.example.ticketreservation.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record ReservationRequest(
        @NotBlank(message = "eventId is required") String eventId,
        @Min(value = 1, message = "seats must be at least 1")
        @Max(value = 10, message = "you can reserve at most 10 seats at once") int seats) {
}
