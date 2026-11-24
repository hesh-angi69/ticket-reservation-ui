package com.example.ticketreservation.dto;

import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.LocalDateTime;

public record EventRequest(
        @NotBlank(message = "name is required") String name,
        String description,
        @NotBlank(message = "venue is required") String venue,
        @NotNull(message = "eventDate is required")
        @Future(message = "eventDate must be in the future") LocalDateTime eventDate,
        @Min(value = 1, message = "totalSeats must be at least 1") int totalSeats,
        @PositiveOrZero(message = "ticketPrice cannot be negative") double ticketPrice) {
}
